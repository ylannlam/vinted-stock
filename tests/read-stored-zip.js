import assert from 'node:assert/strict'
import {crc32} from 'node:zlib'

// Read the ZIP central directory independently of the application's writer.
export function readStoredZip(input){
  const bytes=Buffer.from(input)
  const end=bytes.length-22
  assert.equal(bytes.readUInt32LE(end),0x06054b50,'end of central directory')
  const count=bytes.readUInt16LE(end+10)
  const directory=bytes.readUInt32LE(end+16)
  assert.equal(bytes.readUInt32LE(end+12),end-directory,'central directory length')
  const files=[]
  let at=directory
  for(let i=0;i<count;i++){
    assert.equal(bytes.readUInt32LE(at),0x02014b50,'central directory entry')
    assert.equal(bytes.readUInt16LE(at+10),0,'stored without compression')
    const crc=bytes.readUInt32LE(at+16),size=bytes.readUInt32LE(at+20)
    const nameLength=bytes.readUInt16LE(at+28),local=bytes.readUInt32LE(at+42)
    const name=bytes.toString('utf8',at+46,at+46+nameLength)
    assert.equal(bytes.readUInt32LE(at+24),size,'uncompressed size')
    assert.equal(bytes.readUInt32LE(local),0x04034b50,'local header')
    assert.equal(bytes.readUInt32LE(local+14),crc,'local checksum')
    assert.equal(bytes.readUInt32LE(local+18),size,'local compressed size')
    assert.equal(bytes.readUInt16LE(local+26),nameLength,'local name length')
    assert.equal(bytes.toString('utf8',local+30,local+30+nameLength),name,'local entry name')
    const start=local+30+nameLength+bytes.readUInt16LE(local+28)
    assert.ok(start+size<=directory,'payload fits before the directory')
    const data=bytes.subarray(start,start+size)
    assert.equal(crc32(data)>>>0,crc,'checksum of '+name)
    files.push({name,data})
    at+=46+nameLength+bytes.readUInt16LE(at+30)+bytes.readUInt16LE(at+32)
  }
  assert.equal(at,end,'all directory entries accounted for')
  return files
}
