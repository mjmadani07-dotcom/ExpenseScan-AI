import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { spawnSync } from 'node:child_process';
const root=process.cwd();
const src=resolve(root,'native/android');
const target=resolve(root,'.android-build');
if(!existsSync(resolve(root,'dist/index.html')))throw new Error('Build web assets first: VITE_ANDROID_BUILD=true npm run build');
if(!readFileSync(resolve(root,'dist/index.html'),'utf8').includes('assets/'))throw new Error('Missing built assets');
mkdirSync(target,{recursive:true});
for(const f of ['package.json','capacitor.config.json'])cpSync(join(src,f),join(target,f));
if(existsSync(join(src,'package-lock.json')))cpSync(join(src,'package-lock.json'),join(target,'package-lock.json'));
const run=(cmd,args)=>{const p=spawnSync(cmd,args,{cwd:target,stdio:'inherit',shell:process.platform==='win32'});if(p.status!==0)throw new Error(cmd+' failed');};
run('npm',[existsSync(join(target,'package-lock.json'))?'ci':'install','--no-audit','--no-fund']);
rmSync(join(target,'www'),{recursive:true,force:true});cpSync(resolve(root,'dist'),join(target,'www'),{recursive:true});
// Bundle licensed Persian font locally; no Google Fonts request at runtime.
const fontRoot=join(target,'node_modules/@fontsource/vazirmatn');
const fontOut=join(target,'www/fonts/vazirmatn');
mkdirSync(fontOut,{recursive:true});
let fontCss='';
for(const weight of [400,600,700]){
 const css=readFileSync(join(fontRoot,weight+'.css'),'utf8');
 const files=[...css.matchAll(/url\(["']?\.\/files\/([^"')]+)["']?\)/g)].map(m=>m[1]);
 if(!files.length)throw new Error('Missing local font files');
 for(const file of new Set(files)){mkdirSync(join(fontOut,'files'),{recursive:true});cpSync(join(fontRoot,'files',file),join(fontOut,'files',file));}
 fontCss+=css+'\n';
}
writeFileSync(join(fontOut,'font.css'),fontCss);
cpSync(join(fontRoot,'LICENSE'),join(fontOut,'LICENSE'));
const htmlFile=join(target,'www/index.html');
let html=readFileSync(htmlFile,'utf8').replace(/<link\b[^>]*href=["']https:\/\/fonts\.(?:googleapis|gstatic)\.com[^"']*["'][^>]*>/gi,'').replace(/<link\b[^>]*rel=["']manifest["'][^>]*>/gi,'');
if(/fonts\.(googleapis|gstatic)\.com/.test(html))throw new Error('Remote font link remains in Android bundle');
html=html.replace('</head>','<link rel="stylesheet" href="/fonts/vazirmatn/font.css" /></head>');
writeFileSync(htmlFile,html);
// Native entry does not register PWA service workers. Remove generated registration/cache files.
for(const name of ['sw.js','registerSW.js','manifest.webmanifest'])rmSync(join(target,'www',name),{force:true});
if(!existsSync(join(target,'android')))run('npx',['--no-install','cap','add','android']);
cpSync(join(src,'overlay'),join(target,'android'),{recursive:true,force:true});
const manifest=join(target,'android/app/src/main/AndroidManifest.xml');
let xml=readFileSync(manifest,'utf8').replace(/android:allowBackup="[^"]*"/,'android:allowBackup="false"');
if(!xml.includes('android:allowBackup="false"'))xml=xml.replace('<application','<application android:allowBackup="false"');
if(!xml.includes('android:usesCleartextTraffic='))xml=xml.replace('<application','<application android:usesCleartextTraffic="false"');
if(!xml.includes('android.permission.USE_BIOMETRIC'))xml=xml.replace('</manifest>','<uses-permission android:name="android.permission.USE_BIOMETRIC" />\n</manifest>');
writeFileSync(manifest,xml);
const gradle=join(target,'android/app/build.gradle');
let g=readFileSync(gradle,'utf8');
if(!g.includes('androidx.biometric:biometric:1.1.0')){if(!/dependencies\s*\{/.test(g))throw new Error('Missing app dependencies block');g=g.replace(/dependencies\s*\{/,'dependencies {\n    implementation "androidx.biometric:biometric:1.1.0"');}
if(!g.includes('org.json:json:20240303'))g=g.replace(/dependencies\s*\{/,'dependencies {\n    testImplementation "org.json:json:20240303"');
if(!g.includes('androidx.test:core:'))g=g.replace(/dependencies\s*\{/,'dependencies {\n    androidTestImplementation "androidx.test:core:1.6.1"');
if(!g.includes('androidx.test.ext:junit:'))g=g.replace(/dependencies\s*\{/,'dependencies {\n    androidTestImplementation "androidx.test.ext:junit:1.2.1"');
const code=Number(process.env.ANDROID_VERSION_CODE||1);
if(!Number.isSafeInteger(code)||code<1||code>2100000000)throw new Error('Invalid version code');
const channel=process.env.ANDROID_RELEASE_CHANNEL||'alpha';
if(channel!=='alpha'&&channel!=='beta')throw new Error('Invalid release channel');
g=g.replace(/versionCode\s+\d+/, 'versionCode '+code).replace(/versionName\s+"[^"]+"/,'versionName "0.1.0-'+channel+'.'+code+'"');
writeFileSync(gradle,g);
run('npx',['--no-install','cap','sync','android']);
