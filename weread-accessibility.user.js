// ==UserScript==
// @name         微信读书 NVDA 无障碍
// @namespace    local.weread.accessibility
// @version      0.2.0
// @description  将实际绘制的正文转换成可阅读文本，并补充阅读控件语义
// @author       shengrihui
// @homepageURL  https://github.com/shengrihui/weread-accessibility
// @supportURL   https://github.com/shengrihui/weread-accessibility/issues
// @match        https://weread.qq.com/web/reader/*
// @run-at       document-start
// @grant        none
// @sandbox      raw
// ==/UserScript==

(function () {
  'use strict';
  // Pure layout code also runs in Node for regression checks.
  function linesFromRuns(runs) {
    const rows = [];
    const unique = new Map();
    for (const r of runs) unique.set(`${r.x.toFixed(2)}:${r.y.toFixed(2)}`, r);
    for (const r of [...unique.values()].sort((a, b) => a.y - b.y || a.x - b.x)) {
      let row = rows.find(l => Math.abs(l.y - r.y) < Math.max(2, r.size * .15));
      if (!row) { row = { y: r.y, size: r.size, runs: [] }; rows.push(row); }
      row.runs.push(r);
    }
    return rows.map(row => {
      row.runs.sort((a, b) => a.x - b.x);
      return { text: row.runs.map(r => r.text).join(''), x: row.runs[0].x,
        y: row.y, size: row.size };
    });
  }
  function paragraphsFromLines(lines) {
    const result = [];
    const left = Math.min(...lines.map(l => l.x));
    const gaps = lines.slice(1).map((line,i) => ({line,previous:lines[i]}))
      .filter(({line,previous}) => Math.abs(line.size-previous.size)<line.size*.15
        && line.y-previous.y <= line.size*2.6)
      .map(({line,previous}) => line.y-previous.y).filter(gap=>gap>0).sort((a,b)=>a-b);
    const lineGap = gaps.length ? gaps[Math.floor((gaps.length-1)*.25)] : null;
    for (const line of lines) {
      const p = result[result.length - 1];
      const last = p?.lines[p.lines.length - 1];
      // Visual paragraph reconstruction is a fallback; an indented line starts a paragraph.
      const gap = last ? line.y-last.y : 0;
      const separate = last && (Math.abs(line.size-last.size)>line.size*.2
        || gap > (lineGap ? lineGap*1.3 : line.size*2.3));
      if (!p || separate || line.x - left > line.size * 1.3) {
        result.push({ text: line.text, x: line.x, y: line.y, size: line.size, lines: [line] });
      } else { p.text += line.text; p.lines.push(line); }
    }
    return result;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { linesFromRuns, paragraphsFromLines }; return;
  }
  if (typeof document === 'undefined' || window.__wrAccessibleInstalled) return;
  window.__wrAccessibleInstalled = true;
  const records = new Map();
  let pending = false;
  const readerCanvas = c => c.closest('.readerChapterContent, .renderTargetContainer, .wr_canvasContainer');
  const originalFill = CanvasRenderingContext2D.prototype.fillText;
  const originalClear = CanvasRenderingContext2D.prototype.clearRect;
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; render(); });
  }
  CanvasRenderingContext2D.prototype.fillText = function (text, x, y, ...args) {
    const result = originalFill.call(this, text, x, y, ...args);
    if (readerCanvas(this.canvas) && String(text).trim()) {
      const matrix = this.getTransform();
      const point = new DOMPoint(x, y).matrixTransform(matrix);
      const size = parseFloat(this.font.match(/([\d.]+)px/)?.[1] || '20');
      let record = records.get(this.canvas);
      if (!record) { record = { runs: [], layer: null, signature: '' }; records.set(this.canvas, record); }
      // Coordinates are recorded in backing pixels; render converts to CSS pixels.
      const run = { text: String(text), x: point.x, y: point.y,
        size: size * Math.abs(matrix.d || matrix.a || 1) };
      const existing = record.runs.findIndex(r => Math.abs(r.x-run.x)<.01 && Math.abs(r.y-run.y)<.01);
      if (existing >= 0) record.runs[existing] = run; else record.runs.push(run);
      schedule();
    }
    return result;
  };
  CanvasRenderingContext2D.prototype.clearRect = function (x, y, w, h) {
    const result = originalClear.call(this, x, y, w, h);
    const record = records.get(this.canvas);
    if (record) {
      const m = this.getTransform();
      const a = new DOMPoint(x, y).matrixTransform(m);
      const b = new DOMPoint(x + w, y + h).matrixTransform(m);
      record.runs = record.runs.filter(r => !(r.x >= Math.min(a.x,b.x) && r.x <= Math.max(a.x,b.x)
        && r.y >= Math.min(a.y,b.y) && r.y <= Math.max(a.y,b.y)));
      schedule();
    }
    return result;
  };
  // Assigning a canvas width/height resets its bitmap without calling clearRect.
  for (const key of ['width','height']) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,key);
    if (!descriptor?.set || !descriptor.configurable) continue;
    Object.defineProperty(HTMLCanvasElement.prototype,key,{...descriptor,set(value) {
      descriptor.set.call(this,value);
      const record = records.get(this);
      if (record) { record.runs=[]; schedule(); }
    }});
  }
  function render() {
    for (const [canvas, record] of records) {
      if (!canvas.isConnected) { record.layer?.remove(); records.delete(canvas); continue; }
      const rect = canvas.getBoundingClientRect();
      const rx = rect.width / canvas.width, ry = rect.height / canvas.height;
      if (!rx || !ry) { if (record.layer) record.layer.hidden = true; continue; }
      const runs = record.runs.map(r => ({ ...r, x: r.x * rx, y: r.y * ry, size: r.size * ry }))
        .filter(r => r.x >= -1 && r.y >= -1 && r.x < rect.width && r.y < rect.height);
      const paragraphs = paragraphsFromLines(linesFromRuns(runs));
      if (!record.layer) {
        const layer = document.createElement('div');
        layer.className = 'wr-a11y-text';
        canvas.after(layer); record.layer = layer;
      }
      const layer = record.layer;
      layer.hidden = false;
      canvas.setAttribute('aria-hidden', 'true');
      const parent = layer.offsetParent;
      const pr = parent?.getBoundingClientRect() || { left: 0, top: 0 };
      for (const [key,value] of Object.entries({
        left: `${rect.left - pr.left + (parent?.scrollLeft || 0)}px`,
        top: `${rect.top - pr.top + (parent?.scrollTop || 0)}px`,
        width: `${rect.width}px`, height: `${rect.height}px`
      })) if (layer.style[key] !== value) layer.style[key] = value;
      const signature = JSON.stringify(paragraphs.map(p => [p.text,p.x,p.y,p.size]));
      // Keep nodes stable during scrolling and highlight repaints.
      if (record.signature === signature) continue;
      record.signature = signature;
      layer.replaceChildren(...paragraphs.map(p => {
        const node = document.createElement('p'); node.textContent = p.text;
        const last = p.lines[p.lines.length - 1];
        Object.assign(node.style, { position: 'absolute', margin: '0', left: `${p.x}px`,
          top: `${Math.max(0,p.y - p.size / 2)}px`, width: `${Math.max(1,rect.width-p.x)}px`,
          height: `${last.y-p.y+p.size}px`, fontSize: `${p.size}px` });
        return node;
      }));
    }
    updateReadingRegions();
  }
  function updateReadingRegions() {
    for (const container of document.querySelectorAll('.wr_canvasContainer')) {
      const layers = [...container.querySelectorAll('.wr-a11y-text')].filter(e=>!e.hidden&&e.querySelector('p'));
      if (!layers.length) {
        if (container.dataset.wrA11yRegion) { container.removeAttribute('role'); container.removeAttribute('aria-label'); }
        continue;
      }
      attr(container,'role','region'); attr(container,'aria-label','阅读正文');
      container.dataset.wrA11yRegion='1';
      for (const [i,layer] of layers.entries()) {
        const heading = layer.querySelector('.wr-a11y-heading');
        if (i>0) { heading?.remove(); continue; }
        if (!heading) {
          const node=document.createElement('h2'); node.className='wr-a11y-heading'; node.textContent='阅读正文';
          layer.prepend(node);
        }
      }
    }
  }
  const focusable = 'button,[href],input,select,textarea,[tabindex="0"]';
  const visible = e => !!(e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
  function attr(e, name, value) { if (e.getAttribute(name) !== String(value)) e.setAttribute(name,String(value)); }
  function button(e, label) {
    attr(e,'role','button'); attr(e,'tabindex','0');
    if (label) attr(e,'aria-label',label);
    e.dataset.wrA11yButton = '1';
  }
  function enhance() {
    for (const e of document.querySelectorAll('#preRenderContainer,#preRenderContent')) attr(e,'aria-hidden','true');
    // Running page headers duplicate chapter information; preserve the original visual display.
    for (const e of document.querySelectorAll('.renderTargetPageInfo_header_chapterTitle')) attr(e,'aria-hidden','true');
    for (const e of document.querySelectorAll('.readerControls_item')) {
      const mappings = [['catalog','目录'],['wr_note','笔记'],['showBookReviews','书友想法'],
        ['isHorizontalReader','切换到上下滚动阅读'],['isNormalReader','切换到双栏阅读'],
        ['fontSizeButton','字体和字号'],['white','切换到浅色'],['dark','切换到深色']];
      const name = mappings.find(([c]) => e.classList.contains(c))?.[1]
        || e.querySelector('.wr_tooltip_item')?.textContent.trim() || e.getAttribute('title');
      button(e, name || 'AI 问书');
      if (e.classList.contains('fontSizeButton')) attr(e,'aria-expanded',
        [...document.querySelectorAll('.font-panel-content')].some(visible));
    }
    for (const e of document.querySelectorAll('.font-panel-content-fonts-item')) {
      button(e,e.style.fontFamily.split(',')[0].replace(/-min["']?$/,'').replace(/["']/g,'').trim() || '字体');
      attr(e,'aria-pressed',/selected/i.test(e.className));
    }
    for (const e of document.querySelectorAll('.font-panel-content-fonts-tab-item')) {
      button(e,e.textContent.trim()); attr(e,'aria-pressed',/selected/i.test(e.className));
    }
    for (const e of document.querySelectorAll('.readerCatalog_list_item_inner')) {
      button(e,e.querySelector('.readerCatalog_list_item_title_text')?.textContent.trim() || e.textContent.trim());
      if (/selected/i.test(e.parentElement.className)) attr(e,'aria-current','page');
      else e.removeAttribute('aria-current');
    }
    for (const e of document.querySelectorAll('.readerCatalog_searchBar input')) attr(e,'aria-label','搜索目录');
    for (const e of document.querySelectorAll('.readerCatalog_searchBar_inner_icon_close')) button(e,'清除目录搜索');
    for (const e of document.querySelectorAll('.wr_dialog_closeButton')) button(e,'关闭对话框');
    for (const e of document.querySelectorAll('.reader_font_control_slider_wrapper')) {
      const dots = [...e.querySelectorAll('.reader_font_control_slider_track_level_dot')];
      if (!dots.length) continue;
      attr(e,'role','slider'); attr(e,'tabindex','0'); attr(e,'aria-label','字号');
      attr(e,'aria-valuemin','1'); attr(e,'aria-valuemax',dots.length);
      attr(e,'aria-orientation','horizontal');
      const current=sliderLevel(e,dots);
      attr(e,'aria-valuenow',current+1); attr(e,'aria-valuetext',`第 ${current+1} 级，共 ${dots.length} 级`);
      for (const dot of e.querySelectorAll('[class*="dot"]')) attr(dot,'aria-hidden','true');
    }
    managePanel();
  }
  function sliderLevel(wrapper,dots) {
    const knob=wrapper.querySelector('.reader_font_control_slider_dot');
    if (!knob) return 0;
    const r=knob.getBoundingClientRect(), x=r.left+r.width/2;
    let nearest=0, distance=Infinity;
    dots.forEach((dot,i)=>{ const d=dot.getBoundingClientRect(); const delta=Math.abs(d.left+d.width/2-x);
      if(delta<distance){distance=delta;nearest=i;} });
    return nearest;
  }
  let activePanel = null, returnFocus = null;
  function managePanel() {
    const panel = [...document.querySelectorAll('.wr_dialog,.font-panel-content')].find(visible);
    if (panel === activePanel) return;
    if (activePanel && !panel) { const previous = returnFocus; activePanel = null; returnFocus = null; if (previous?.isConnected) previous.focus(); return; }
    if (panel) {
      returnFocus = document.activeElement; activePanel = panel;
      attr(panel,'role','dialog'); attr(panel,'aria-label',panel.matches('.wr_dialog') ? '微信读书对话框' : '字体和字号');
      // Background is not inert: font controls are a nonmodal popover.
      const first = [...panel.querySelectorAll(focusable)].find(visible); first?.focus();
    }
  }
  document.addEventListener('keydown', event => {
    const slider=event.target.closest?.('[role="slider"].reader_font_control_slider_wrapper');
    if(slider && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key)) {
      const dots=[...slider.querySelectorAll('.reader_font_control_slider_track_level_dot')];
      if(!dots.length) return;
      let next=sliderLevel(slider,dots);
      if(event.key==='Home') next=0;
      else if(event.key==='End') next=dots.length-1;
      else next+=['ArrowRight','ArrowUp','PageUp'].includes(event.key)?1:-1;
      next=Math.max(0,Math.min(dots.length-1,next));
      const r=dots[next].getBoundingClientRect();
      event.preventDefault();event.stopImmediatePropagation();
      dots[next].dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2}));
      requestAnimationFrame(enhance);return;
    }
    const target = event.target.closest?.('[data-wr-a11y-button]');
    if (target && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault(); event.stopImmediatePropagation(); target.click(); return;
    }
    if (activePanel && activePanel.contains(event.target) && event.key === 'Escape') {
      const close = activePanel.querySelector('.wr_dialog_closeButton')
        || document.querySelector('.reader-font-control-panel-mask')
        || document.querySelector('.fontSizeButton');
      if (close) { event.preventDefault(); event.stopImmediatePropagation(); close.click(); }
    }
    // Do not let WeRead's document handler turn pages while operating a control.
    if (target && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','PageUp','PageDown'].includes(event.key)) event.stopPropagation();
  }, true);
  function start() {
    const style = document.createElement('style');
    style.textContent = '.wr-a11y-text{position:absolute;pointer-events:none;color:transparent!important;overflow:hidden;z-index:1}.wr-a11y-text p{color:transparent!important;user-select:none}.wr-a11y-heading{position:absolute!important;top:0!important;left:0!important;width:1px!important;height:1px!important;overflow:hidden!important;clip-path:inset(50%)!important;margin:0!important}[data-wr-a11y-button]:focus-visible,[role="slider"]:focus-visible{outline:2px solid #4589ff!important;outline-offset:3px}';
    document.head.append(style);
    let queued = false;
    const observer = new MutationObserver(mutations => {
      if (mutations.every(m => m.target.closest?.('.wr-a11y-text'))) return;
      if (!queued) { queued = true; requestAnimationFrame(() => { queued=false; enhance(); schedule(); }); }
    });
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style']});
    new ResizeObserver(schedule).observe(document.body);
    enhance();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start,{once:true}); else start();
})();
