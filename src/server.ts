import * as http from './http'
import { RestartError } from './http'
import Parser from './parser'

http.clearSession().then(start)

async function start() {
    await http.initializeSession(async () => {
        try {
            const parser = new Parser()
            await parser.crawl()
        } catch (e) {
            console.warn(`%O`, e)
            if (e instanceof RestartError) setTimeout(async () => {
                await http.clearSession()
                start()
            }, 3000)
        }
    })
}