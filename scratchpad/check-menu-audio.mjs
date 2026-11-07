import { chromium } from 'file:///C:/Users/17920/AppData/Local/npm-cache/_npx/c61c9351a0dbcfa7/node_modules/playwright/index.mjs';
const autoplay=process.argv.includes('--autoplay');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:[`--autoplay-policy=${autoplay?'no-user-gesture-required':'document-user-activation-required'}`]});
try {
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5175/',{waitUntil:'networkidle'});
 await page.waitForFunction(()=>!document.querySelector('#start-btn').disabled);
 if(!autoplay) {
   if(await page.locator('#music-btn').getAttribute('aria-pressed')==='true')throw Error('Blocked playback reported playing');
   await page.keyboard.press('ArrowRight');
 }
 await page.waitForFunction(()=>document.querySelector('#menu-music').currentTime>.3);
 await page.waitForFunction(()=>document.querySelector('#music-btn').getAttribute('aria-pressed')==='true');
 const duration=await page.locator('#menu-music').evaluate(a=>a.duration);
 if(!Number.isFinite(duration)||duration<10)throw Error('Invalid music');
 await page.locator('#music-btn').click();
 if(!await page.locator('#menu-music').evaluate(a=>a.paused))throw Error('Mute failed');
 await page.reload({waitUntil:'networkidle'});
 if(!autoplay) await page.keyboard.press('ArrowRight');
 await page.waitForFunction(()=>!document.querySelector('#menu-music').paused);
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'scratchpad/menu-audio-mobile.png'});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile overflow');
 await page.locator('#guide-btn').click();await page.locator('#guide-close').click();
 await page.locator('#start-btn').click();
 await page.waitForFunction(()=>document.querySelector('#menu').classList.contains('intro-playing'));
 await page.locator('#intro-skip').click();
 await page.waitForFunction(()=>document.querySelector('#menu-music')?.paused);
 await page.reload({waitUntil:'networkidle'});
 await page.locator('#motion-btn').click();
 await page.locator('#start-btn').click();
 await page.waitForFunction(()=>document.querySelector('#menu-music')?.paused);
 if(errors.length)throw Error(errors.join('\n'));
 console.log({duration,autoplay,playback:'passed',mute:'passed',reloadDefaultOn:'passed',mobile:'passed',introCleanup:'passed',directStart:'passed',errors});
}finally{await browser.close();}
