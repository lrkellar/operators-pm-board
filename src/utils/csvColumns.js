// Papa.unparse takes its columns from the first row only, so a field that the first row lacks
// (notes, file_link, duration_days...) is silently dropped from every row on save. Pass the
// union of every row's keys instead, in first-seen order.
export function csvColumns(rows) {
  const seen = new Set()
  const columns = []
  for (const row of rows ?? []) {
    for (const key of Object.keys(row ?? {})) {
      if (!seen.has(key)) { seen.add(key); columns.push(key) }
    }
  }
  return columns
}
