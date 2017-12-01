import * as fs from 'fs'
import * as path from 'path'
import { Stats } from 'fs'
import * as util from 'util'

const mkdirAsync = util.promisify(fs.mkdir)

export async function exists(filePath: string) {
    return await new Promise<boolean>(async (res, rej) => {
        try {
            const stat = await util.promisify(fs.stat)(filePath)
            res(true)
        } catch {
            res(false)
        }
    })
}

export async function mkdirp(dir: string, mode = 0o777) {
    try {
        await mkdirAsync(dir);
    } catch (e) {
        // `dir` exists
        if (e.code === 'EEXIST') {
            return;
        }
        // parent not exist
        if (e.code === 'ENOENT') {
            // create parent
            await mkdirp(path.dirname(dir));
            // then create target
            await mkdirAsync(dir);
            return;
        }
        // unknown error
        throw e;
    }
}

export const stat = util.promisify(fs.stat)
export const unlink = util.promisify(fs.unlink)
export const read = util.promisify(fs.readFile)
export const write = util.promisify(fs.writeFile)

export const createWriteStream = fs.createWriteStream