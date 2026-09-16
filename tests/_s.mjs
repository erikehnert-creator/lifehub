import { chromium } from 'playwright'
import { startOptionen, EINZELDATEI, DIST } from './_browser.mjs'
const ctx=await chromium.launchPersistentContext('/tmp/blick-profil',startOptionen({viewport:{width:1280,height:950}}))
const p=ctx.pages()[0]??await ctx.newPage()
await p.goto(EINZELDATEI + '#/finanzen')
await p.waitForSelector('#root > *',{timeout:40000}); await p.waitForTimeout(2500)
await p.locator('.content').evaluate(el=>el.scrollTop=760)
await p.waitForTimeout(700)
await p.screenshot({path:'/tmp/blick/19-prognose.png'})
await p.goto(EINZELDATEI + '#/plan/alle'); await p.waitForTimeout(2000)
await p.screenshot({path:'/tmp/blick/20-aufgaben.png'})
await ctx.close()
