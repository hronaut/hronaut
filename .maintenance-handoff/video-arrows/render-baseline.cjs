const {createRequire}=require('node:module');
const requireTask=createRequire('/home/hronom/Dev/hronaut/hronaut/package.json');
const fs=require('node:fs');
(async()=>{
const output=await requireTask('esbuild').build({entryPoints:['/home/hronom/Dev/hronaut/hronaut/src/renderer/src/video/draw.ts'],bundle:true,platform:'browser',format:'iife',globalName:'HronautArrow',write:false});
fs.writeFileSync('/home/hronom/Dev/hronaut/.hronaut-maintenance/evidence/video-arrows/'+(process.argv[2]||'before')+'.js',output.outputFiles[0].text);
const browser=await requireTask('playwright').chromium.launch({headless:true,executablePath:'/home/hronom/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'});
try{
const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});
await page.setContent('<canvas id="scene" width="1280" height="720"></canvas><style>body{margin:0}canvas{display:block}</style>');
await page.addScriptTag({content:output.outputFiles[0].text});
await page.evaluate(()=>{
const ctx=document.querySelector('canvas').getContext('2d');
for(const [top,dark]of [[0,false],[360,true]]){
ctx.fillStyle=dark?'#111827':'#f1f5f9';ctx.fillRect(0,top,1280,360);
ctx.fillStyle=dark?'#1f2937':'#ffffff';ctx.beginPath();ctx.roundRect(600,top+84,560,212,18);ctx.fill();
ctx.fillStyle=dark?'#f8fafc':'#172033';ctx.font='600 24px Arial';ctx.fillText(dark?'Dark page':'Light page',44,top+48);ctx.fillText('Workspace settings',634,top+126);
ctx.fillStyle=dark?'#cbd5e1':'#64748b';ctx.font='16px Arial';ctx.fillText('Invite people to your project',634,top+162);
ctx.fillStyle='#7c3aed';ctx.beginPath();ctx.roundRect(968,top+224,160,42,10);ctx.fill();ctx.fillStyle='#fff';ctx.font='600 16px Arial';ctx.fillText('Send invite',1002,top+251);
ctx.fillStyle=dark?'#9ca3af':'#64748b';ctx.font='14px Arial';ctx.fillText('Curved pointer',46,top+316);ctx.fillText('Short pointer',328,top+316);ctx.fillText('Early drawing frame',46,top+240);
const common={kind:'arrow',startMs:0,endMs:3000,color:'#7c3aed',animation:'none'};
HronautArrow.drawVideoAnnotations(ctx,[{...common,x:0.07,y:(top+110)/720,endX:0.34,endY:(top+245)/720,curvature:-0.28},{...common,x:0.34,y:(top+280)/720,endX:0.36,endY:(top+264)/720,curvature:0},{...common,x:0.58,y:(top+280)/720,endX:0.75,endY:(top+245)/720,curvature:0.15}],600,1280,720);
HronautArrow.drawVideoAnnotations(ctx,[{...common,x:0.07,y:(top+200)/720,endX:0.34,endY:(top+245)/720,curvature:-0.1,animation:'draw'}],18,1280,720);
}
});
await page.screenshot({path:'/home/hronom/Dev/hronaut/.hronaut-maintenance/evidence/video-arrows/'+(process.argv[2]||'before')+'.png'});
}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
