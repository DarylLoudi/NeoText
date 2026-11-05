/** Additional authenticated data that binds a ciphertext to its table, column and row. */
export function aad(table: string, column: string, rowId: string): string {
  return `neotext/v1/${table}/${column}/${rowId}`;
}
