// Get rows and their exact count together. Only out-of-range pages need a count-only retry.
export async function readPage(makeQuery, offset, size = 250) {
  const { data, count, error } = await makeQuery(false).range(offset, offset + size - 1)
  if (!error) return { data: data || [], count }
  if (error.code !== 'PGRST103') throw error
  const counted = await makeQuery(true)
  if (counted.error) throw counted.error
  if (offset >= counted.count) return { data: [], count: counted.count }
  throw error
}
