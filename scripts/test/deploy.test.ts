/**
 * PLAN 7.1: the deploy scripts parse, and their dry runs print the plan without changing anything.
 *
 * "Without changing anything" is checked, not trusted: every command that could change the host
 * (package installs, services, files under /etc, the deploy checkout, sudo, the network) is replaced
 * by a shim first on PATH that only logs its call, and a dry run must leave that log empty. Git's
 * read-only subcommands pass through to the real git, its others are logged like the rest.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repo = resolve(import.meta.dirname, "..", "..");
const install = join(repo, "deploy", "install.sh");
const update = join(repo, "deploy", "update.sh");
const SITE = "203-0-113-10.sslip.io"; // a documentation address (RFC 5737), never a real host
const FAKE_KEY = "sk-fake-value-that-must-never-be-printed";

const SHIMMED = [
  "apt-get",
  "caddy",
  "chmod",
  "chown",
  "cp",
  "curl",
  "gpg",
  "install",
  "journalctl",
  "ln",
  "mkdir",
  "mktemp",
  "mv",
  "pnpm",
  "rm",
  "runuser",
  "sudo",
  "systemctl",
  "tee",
  "ufw",
  "visudo",
];
const GIT_READ_ONLY = ["rev-parse", "log", "status", "remote"];

let dir: string;
let log: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sideline-deploy-"));
  log = join(dir, "calls.log");
  writeFileSync(log, "");
  const shims = join(dir, "bin");
  mkdirSync(shims);
  for (const name of SHIMMED) {
    const path = join(shims, name);
    writeFileSync(path, `#!/bin/sh\necho "${name} $*" >> "${log}"\n`);
    chmodSync(path, 0o755);
  }
  const git = join(shims, "git");
  writeFileSync(
    git,
    [
      "#!/bin/bash",
      'all=("$@")',
      "while [[ $1 == -C ]]; do shift 2; done",
      `case $1 in ${GIT_READ_ONLY.join("|")}) exec /usr/bin/git "\${all[@]}" ;; esac`,
      `echo "git \${all[*]}" >> "${log}"`,
    ].join("\n"),
  );
  chmodSync(git, 0o755);
  env = { ...process.env, PATH: `${shims}:${process.env.PATH ?? ""}` };
  writeFileSync(
    join(dir, "fixture.env"),
    [
      `OPENAI_API_KEY=${FAKE_KEY}`,
      "OPENAI_BASE_URL=https://llm.example.test/v1",
      "SIDELINE_MODEL_FAST=model-a",
      "SIDELINE_MODEL_SMART=model-b",
      "HOST=0.0.0.0",
      "SOME_OTHER_TOKEN=not-copied",
    ].join("\n"),
  );
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const runScript = (script: string, args: string[]) =>
  spawnSync("bash", [script, ...args], { cwd: repo, env, encoding: "utf8", timeout: 60_000 });

describe("deploy scripts (PLAN 7.1)", () => {
  it.each([install, update])("%s parses (bash -n) and is executable", (script) => {
    const parsed = spawnSync("bash", ["-n", script], { encoding: "utf8" });
    expect(parsed.status).toBe(0);
    expect(parsed.stderr).toBe("");
    expect(statSync(script).mode & 0o111).toBe(0o111);
  });

  it("install.sh --dry-run prints every step and changes nothing", () => {
    const out = runScript(install, [
      "--dry-run",
      "--site",
      SITE,
      "--env-file",
      join(dir, "fixture.env"),
    ]);
    const text = `${out.stdout}${out.stderr}`;
    expect(out.status, text).toBe(0);
    expect(readFileSync(log, "utf8")).toBe("");
    expect(text).toContain(`install: site https://${SITE}/  ref main`);
    expect(text).toMatch(/would run: git (clone|-C \/srv\/sideline fetch)/);
    expect(text).toContain("would run: pnpm --dir /srv/sideline build");
    expect(text).toMatch(
      /would run: env DEBIAN_FRONTEND=noninteractive apt-get install|caddy is installed: 2\./,
    );
    expect(text).toContain(`install:     ${SITE} {`);
    expect(text).toContain("install:     \treverse_proxy 127.0.0.1:8787");
    expect(text).toMatch(/(would write|unchanged) \/etc\/caddy\/Caddyfile/);
    expect(text).toContain("deploy-env: forced HOST, NODE_ENV, PORT");
    expect(text).toContain(
      "deploy-env: copied OPENAI_API_KEY, OPENAI_BASE_URL, SIDELINE_MODEL_FAST, SIDELINE_MODEL_SMART",
    );
    expect(text).toContain("deploy-env: not copied SOME_OTHER_TOKEN");
    expect(text).toMatch(/would write \/etc\/sideline\/sideline\.env \(mode 600\)/);
    expect(text).toContain("install:     ExecStart=");
    expect(text).toContain("install:     WorkingDirectory=/srv/sideline");
    expect(text).toMatch(/(would write|unchanged) \/etc\/systemd\/system\/sideline\.service/);
    expect(text).toMatch(/(would write|unchanged) \/etc\/sudoers\.d\/sideline/);
    expect(text).toContain("would run: /usr/bin/systemctl restart sideline");
    expect(text).toContain(`then https://${SITE}/api/health`);
    expect(out.stdout.trimEnd().endsWith("install: dry run: nothing was changed")).toBe(true);
    // Names, never values: neither the key nor a value production does not take is printed.
    expect(text).not.toContain(FAKE_KEY);
    expect(text).not.toContain("not-copied");
  });

  // systemctl is called by absolute path (root does not trust PATH), so no shim can stand in for it.
  it("install.sh calls systemctl only through run(), which a dry run turns into a print", () => {
    const calls = readFileSync(install, "utf8")
      .split("\n")
      .filter((line) => line.includes('"$SYSTEMCTL" '));
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const line of calls) expect(line.trim()).toMatch(/^(if ! )?run "\$SYSTEMCTL" /);
  });

  it("install.sh refuses to run for real without root, before changing anything", () => {
    const out = runScript(install, ["--site", SITE]);
    expect(out.status).toBe(1);
    expect(out.stderr).toContain("install: error: run it with sudo:");
    expect(readFileSync(log, "utf8")).toBe("");
  });

  it("update.sh --dry-run prints the redeploy of a ref and changes nothing", () => {
    const target = join(dir, "deploy-checkout");
    const out = runScript(update, ["--dry-run", "--dir", target, "t06-verified"]);
    const text = `${out.stdout}${out.stderr}`;
    expect(out.status, text).toBe(0);
    expect(readFileSync(log, "utf8")).toBe("");
    expect(existsSync(target)).toBe(false);
    expect(text).toContain("(t06-verified) to ");
    expect(text).toContain(`would run: git clone --quiet ${repo} ${target}`);
    expect(text).toMatch(/would run: git -C \S+ checkout --quiet --detach [0-9a-f]{40}\n/);
    expect(text).toContain(`would run: pnpm --dir ${target} install --frozen-lockfile`);
    expect(text).toContain("would run: sudo -n systemctl restart sideline");
    expect(out.stdout.trimEnd().endsWith("update: dry run: nothing was changed")).toBe(true);
  });

  it("update.sh names a ref that does not exist instead of deploying something else", () => {
    const out = runScript(update, ["--dry-run", "--dir", join(dir, "x"), "no-such-ref-anywhere"]);
    expect(out.status).toBe(1);
    expect(out.stderr).toContain("update: error: no commit for 'no-such-ref-anywhere'");
  });
});
