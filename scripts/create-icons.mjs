import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const svg=await readFile(new URL('../public/icon.svg',import.meta.url),'utf8');
for(const size of [192,512]){await page.setViewportSize({width:size,height:size});await page.setContent(`<style>html,body{margin:0;width:100%;height:100%}svg{width:100%;height:100%;display:block}</style>${svg}`);await page.screenshot({path:`public/icon-${size}.png`,omitBackground:true});}
await browser.close();
