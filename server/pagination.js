// Count before requesting a range: PostgREST rejects offsets beyond the result set.
export async function readPage(makeQuery, offset, size = 250) {
  const { count, error: countError } = await makeQuery(true)
  if (countError) throw countError
  if (offset >= count) return { data: [], count }
  const { data, error } = await makeQuery(false).range(offset, offset + size - 1)
  if (error) throw error
  return { data, count }
}
