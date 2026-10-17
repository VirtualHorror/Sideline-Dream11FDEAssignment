/**
 * Rows a sandboxed SQL query returned, as a table that scrolls inside its own box (never the page).
 * Callers: companion/cards/TakeCard.tsx (stat-back's evidence) and controlplane/InspectorQuery.tsx.
 */
export function RowsTable({
  rows,
  columns,
  label,
}: {
  rows: readonly Record<string, unknown>[];
  /** Column order; defaults to the first row's keys. */
  columns?: readonly string[];
  label: string;
}) {
  const names = columns && columns.length > 0 ? columns : Object.keys(rows[0] ?? {});
  const cell = (value: unknown) =>
    value === null || value === undefined
      ? ""
      : typeof value === "number"
        ? String(Number.isInteger(value) ? value : Number(value.toFixed(4)))
        : String(value);
  return (
    <div className="cp-scroll">
      <table className="cp-table" aria-label={label}>
        <thead>
          <tr>
            {names.map((name) => (
              <th key={name} scope="col">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            // Rows have no id of their own; their order is the query's.
            // biome-ignore lint/suspicious/noArrayIndexKey: query rows have no identity
            <tr key={index}>
              {names.map((name) => (
                <td key={name} className={typeof row[name] === "number" ? "cp-num" : undefined}>
                  {cell(row[name])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
