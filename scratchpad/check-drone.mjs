import { chromium } from 'file:///C:/Users/17920/AppData/Local/npm-cache/_npx/c61c9351a0dbcfa7/node_modules/playwright/index.mjs';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 async function clickMoving(action) {
   const button=page.locator(`[data-action="${action}"]`);
   await button.waitFor({state:'visible'});
   const rect=await button.boundingBox();
   await page.mouse.click(rect.x+rect.width/2,rect.y+rect.height/2);
 }
 await page.goto('http://127.0.0.1:5175/',{waitUntil:'networkidle'});
 await page.waitForSelector('.menu-drone:not([hidden])');
 await page.waitForTimeout(1000);
 await page.screenshot({path:'scratchpad/drone-home.png'});
 const box=await page.locator('.menu-drone').boundingBox();
 if(Math.abs(box.width-300)>.1||Math.abs(box.height-300)>.1)throw Error('Drone is not twice the original size: '+JSON.stringify(box));
 await page.mouse.move(box.x+150,box.y+150);
 await clickMoving('follow');
 await page.mouse.move(500,400);
 await page.waitForTimeout(900);
 if(await page.locator('.menu-drone').getAttribute('data-state')!=='following')throw Error('Follow failed');
 const followed=await page.locator('.menu-drone').boundingBox();
 if(Math.abs(followed.x+150-620)>35)throw Error('Drone did not follow cursor');
 await page.mouse.click(500,400,{button:'right'});
 await page.screenshot({path:'scratchpad/drone-confirm.png'});
 await clickMoving('cancel');
 if(await page.locator('.menu-drone').getAttribute('data-state')!=='following')throw Error('Cancel detached');
 await page.mouse.click(500,400,{button:'right'});
 await clickMoving('detach');
 await page.waitForFunction(()=>document.querySelector('.menu-drone').dataset.state==='free');
 await page.setViewportSize({width:390,height:844});
 await page.mouse.move(0,0); await page.waitForTimeout(500);
 const mobile=await page.locator('.menu-drone').boundingBox();
 if(mobile.x<-.1||mobile.x+mobile.width>390.1)throw Error('Mobile drone cropped');
 await page.screenshot({path:'scratchpad/drone-mobile.png'});
 await page.setViewportSize({width:1440,height:900});
 await page.locator('#start-btn').click();
 await page.waitForFunction(()=>document.querySelector('.menu-drone')?.hidden);
 if(errors.length)throw Error(errors.join('\n'));
 console.log('Actual Flying Drone: follow, right-click confirmation, cancel, detach, cleanup passed.');
} finally {await browser.close();}
