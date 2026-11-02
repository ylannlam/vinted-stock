// Only an explicit terminal size is accepted from a title. Measurements and
// references elsewhere in the title are not clothing sizes.
export function sizeFromTitle(title) {
  if(typeof title!=='string')return null
  const match=title.match(/\btaille\s*:?\s*(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|[2-6]XL|\d{2}|unique)\s*[.!]?\s*$/i)
  if(!match||/tour\s+de\s*$/i.test(title.slice(0,match.index)))return null
  return match[1].toLowerCase()==='unique'?'Taille unique':match[1].toUpperCase()
}

export function sizeFromLabel(label) {
  if(typeof label!=='string'||!label.trim()||label.length>80)return null
  const text=label.trim(),letter=text.match(/^(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|[2-6]XL)(?:\s*\/\s*\d+(?:\s*\/\s*\d+)*)?$/i)
  return letter?letter[1].toUpperCase():text
}
