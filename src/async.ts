import * as async from 'async'

export async function parallelLimit (...args: any[]) {
    return new Promise((resolve, reject) => {
        async.parallelLimit.apply(async, [...args, (err: any, results: any) => {
            if (err) return resolve(err)
            resolve(results)
        }])
    })
}

export const compose = async.compose

export async function execute (tasks: (() => Promise<any>)[]) {
    return new Promise(async (resolve, reject) => {
        try {
            const result = await Promise.all(tasks.reduce((promises, task) => {
                return [...promises, Promise.all(promises).then(async () => {
                    const res = await task()
                    return res
                })]
            }, []))
            resolve(result)
        } catch (e) {
            reject(e)
        }
    })
}