(()=> {
  'use strict'; const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)]; const clamp=(v,a=-1,b=1)=>Math.max(a,Math.min(b,v)); const STORAGE='joystickMappingExplorer.config.v1', PRESETS='joystickMappingExplorer.presets.v1'; const actionOptions=[['forward','Forward'],['backward','Backward'],['forward_left','Forward + turn left'],['forward_right','Forward + turn right'],['backward_left','Backward + turn left'],['backward_right','Backward + turn right'],['rotate_left','Rotate left'],['rotate_right','Rotate right'],['stop','Stop / no action']]; function defaults(n) {
    if(n===4)return[['Forward','forward'],['Right','rotate_right'],['Backward','backward'],['Left','rotate_left']]; if(n===6)return[['Forward','forward'],['Forward Right','forward_right'],['Backward Right','backward_right'],['Backward','backward'],['Backward Left','backward_left'],['Forward Left','forward_left']]; if(n===8)return[['Forward','forward'],['Forward Right','forward_right'],['Right','rotate_right'],['Backward Right','backward_right'],['Backward','backward'],['Backward Left','backward_left'],['Left','rotate_left'],['Forward Left','forward_left']]; let out=[]; for(let i=0; i<n; i++) {
      const a=i*360/n; if(i===0)out.push(['Forward','forward']); else if(Math.abs(a-180)<360/n/2)out.push(['Backward','backward']); else if(a<180)out.push(['Sector '+(i+1),a<90?'forward_right':'backward_right']); else out.push(['Sector '+(i+1),a<270?'backward_left':'forward_left'])
    }
    return out
  }
  function makeMapping(n) {
    if(!n)return {
      type:0,widths:null,labels:null,actions:null
    } ; const d=defaults(n); return {
      type:n,widths:Array(n).fill(360/n),labels:d.map(v=>v[0]),actions:d.map(v=>v[1])
    }
  }
  function baseState(types=[4,8,0]) {
    return {
      version:1,speedResponse:'fine',slots:types.map(makeMapping)
    }
  }
  let state=baseState(), selected=new Set([0]), x=0,y=0,gamepadActive=false,raf=null; const floorStates=[0,1,2].map(()=>( {
    worldX:0,worldY:0,heading:0,mapPath:[ {
      x:0,y:0
    } ]
  } )); const mapViews=[0,1,2].map(()=>( {
    panX:0,panY:0,zoom:1,dragging:false,pointerId:null,startX:0,startY:0,baseX:0,baseY:0,moved:false
  } )); let motionRaf=null,lastMotionTime=null; const builtIns= {
    default: {
      name:'Default — 4 / 8 / Continuous',state:baseState([4,8,0])
    } ,sectorCompare: {
      name:'Sector comparison — 4 / 6 / 8',state:baseState([4,6,8])
    }
  } ; function clone(v) {
    return JSON.parse(JSON.stringify(v))
  }
  function safeText(s) {
    return String(s??'')
  }
  function typeOptions(cur) {
    let h='<option value="0">Continuous</option>'; for(let n=4; n<=8; n++)h+=`<option value="${n}" ${cur===n?'selected':''}>${n} sectors</option>`; return h
  }
  function cardHTML(i) {
    return `<article class="card" data-index="${i}"><div class="card-head"><div><label for="type${i}">Comparison ${String.fromCharCode(65+i)}</label><select class="mapping-type" id="type${i}">${typeOptions(state.slots[i].type)}</select></div><div class="intent" aria-live="polite"></div></div><div class="joy" tabindex="0" role="application" aria-label="Comparison ${String.fromCharCode(65+i)} joystick. Drag, or use arrow keys. Space centers the joystick."><svg viewBox="0 0 100 100" aria-hidden="true"></svg><div class="center-dot"></div><div class="knob"></div></div><div class="path-block"><div class="path-title">Occupant view</div><canvas class="occupant-canvas" width="480" height="360" role="img" aria-label="Chair-relative view with stationary wheelchair and infinite moving checkerboard"></canvas><div class="mini-map-wrap"><div class="map-heading"><span>Outside view — persistent path</span><button class="recenter-map" type="button" disabled>Recenter</button></div><canvas class="map-canvas" width="480" height="260" role="img" aria-label="World-relative following view of accumulated wheelchair path. Drag to pan or use the mouse wheel to zoom while stopped."></canvas></div></div><p class="description"></p></article>`
  }
  function buildCards() {
    $('#comparisonGrid').innerHTML=[0,1,2].map(cardHTML).join(''); $$('.mapping-type').forEach((el,i)=>el.addEventListener('change',()=> {
      state.slots[i]=makeMapping(+el.value); if(+$('#editSlot').value===i) {
        selected=new Set([0]); buildEditor()
      }
      render(); autoSave()
    } )); attachJoystickEvents(); attachMapEvents()
  }
  function polar(r,a) {
    const q=(a-90)*Math.PI/180; return[50+r*Math.cos(q),50+r*Math.sin(q)]
  }
  function wedge(a,b) {
    const p=polar(49,a),q=polar(49,b),large=b-a>180?1:0; return`M50 50 L${p[0]} ${p[1]} A49 49 0 ${large} 1 ${q[0]} ${q[1]} Z`
  }
  function bounds(arr) {
    let out=[],cur=-arr[0]/2; out.push([cur,arr[0]/2]); cur=arr[0]/2; for(let i=1; i<arr.length; i++) {
      out.push([cur,cur+arr[i]]); cur+=arr[i]
    }
    return out
  }
  function svgEscape(s) {
    return safeText(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  }
  function short(s) {
    s=safeText(s); return s.length>13?s.slice(0,11)+'…':s
  }
  function drawMapping(s) {
    if(!s.type)return'<circle cx="50" cy="50" r="49" class="fill0"/><line x1="50" y1="1" x2="50" y2="99" class="sector-line"/><line x1="1" y1="50" x2="99" y2="50" class="sector-line"/><text x="50" y="12" class="sector-text">FORWARD</text><text x="50" y="89" class="sector-text">BACK</text><text x="14" y="50" class="sector-text">LEFT</text><text x="86" y="50" class="sector-text">RIGHT</text>'; const bs=bounds(s.widths); let h=''; bs.forEach((b,i)=> {
      const p0=polar(49,b[0]),p=polar(34,(b[0]+b[1])/2); h+=`<path d="${wedge(b[0],b[1])}" class="fill${i%4}"/><line x1="50" y1="50" x2="${p0[0]}" y2="${p0[1]}" class="sector-line"/><text x="${p[0]}" y="${p[1]}" class="sector-text">${svgEscape(short(s.labels[i]))}</text>`
    } ); return h
  }
  function speed(r) {
    let v=r; if(state.speedResponse==='fine')v=r*r; if(state.speedResponse==='stepped')v=r<.34?.25:r<.7?.6:1; return Math.round(v*100)
  }
  function actionName(a) {
    return actionOptions.find(v=>v[0]===a)?.[1]||a
  }
  function sectorIndex(a,arr) {
    a=(a+360)%360; const bs=bounds(arr); for(let i=0; i<bs.length; i++) {
      const lo=(bs[i][0]+360)%360,hi=(bs[i][1]+360)%360; if(lo<=hi) {
        if(a>=lo&&a<hi)return i
      } else if(a>=lo||a<hi)return i
    }
    return 0
  }
  function actionVector(a,r) {
    const t=.72*r; switch(a) {
      case'forward':return[r,0]; case'backward':return[-r,0]; case'forward_left':return[.82*r,-t]; case'forward_right':return[.82*r,t]; case'backward_left':return[-.82*r,t]; case'backward_right':return[-.82*r,-t]; case'rotate_left':return[0,-r]; case'rotate_right':return[0,r]; default:return[0,0]
    }
  }
  function interpret(s) {
    const r=Math.min(1,Math.hypot(x,y)); if(r<.06)return {
      label:'STOP',sub:'0% speed',lin:0,ang:0,command:'stop',desc:'Joystick centered: stop.'
    } ; if(!s.type) {
      const f=-y,rt=x; let label=f>=0?'FORWARD':'BACKWARD'; if(Math.abs(rt)>.08)label+=' + '+(rt>0?'RIGHT TURN':'LEFT TURN'); return {
        label,sub:speed(r)+'% speed',lin:f,ang:rt,command:'move',desc:'Continuous control: joystick angle directly affects steering.'
      }
    }
    const a=Math.atan2(x,-y)*180/Math.PI,i=sectorIndex(a,s.widths),v=actionVector(s.actions[i],r); return {
      label:s.labels[i].toUpperCase(),sub:actionName(s.actions[i])+' · '+speed(r)+'% speed',lin:v[0],ang:v[1],command:s.actions[i],desc:'Selected sector action: '+actionName(s.actions[i])+'.'
    }
  }
  function resetMapViews() {
    for(const v of mapViews) {
      v.panX=0; v.panY=0; v.zoom=1; v.dragging=false; v.pointerId=null; v.moved=false
    }
  }
  function resetFloorStates() {
    for(const f of floorStates) {
      f.worldX=0; f.worldY=0; f.heading=0; f.mapPath=[ {
        x:0,y:0
      } ]
    }
    resetMapViews()
  }
  function canvasSize(canvas) {
    const r=canvas.getBoundingClientRect(),d=Math.max(1,window.devicePixelRatio||1),w=Math.max(1,Math.round(r.width*d)),h=Math.max(1,Math.round(r.height*d)); if(canvas.width!==w||canvas.height!==h) {
      canvas.width=w; canvas.height=h
    }
    const ctx=canvas.getContext('2d'); ctx.setTransform(d,0,0,d,0,0); return {
      ctx,w:r.width,h:r.height
    }
  }
  function drawWheelchair(ctx,cx,cy,heading=0,scale=1) {
    ctx.save(); ctx.translate(cx,cy); ctx.rotate(heading); ctx.lineWidth=2; ctx.strokeStyle='#344054'; ctx.fillStyle='#f8fafc'; ctx.fillRect(-13*scale,-12*scale,26*scale,25*scale); ctx.strokeRect(-13*scale,-12*scale,26*scale,25*scale); ctx.fillStyle='#667085'; ctx.fillRect(-14*scale,8*scale,28*scale,7*scale); ctx.fillStyle='#344054'; ctx.fillRect(-20*scale,-10*scale,5*scale,25*scale); ctx.fillRect(15*scale,-10*scale,5*scale,25*scale); ctx.beginPath(); ctx.arc(-14*scale,-18*scale,4*scale,0,Math.PI*2); ctx.arc(14*scale,-18*scale,4*scale,0,Math.PI*2); ctx.fill(); ctx.restore()
  }
  function drawOccupant(card,i) {
    const canvas=card.querySelector('.occupant-canvas'); if(!canvas)return; const {
      ctx,w,h
    }
    =canvasSize(canvas),f=floorStates[i],cx=w/2,cy=h/2,cell=34; ctx.clearRect(0,0,w,h); ctx.fillStyle='#20242a'; ctx.fillRect(0,0,w,h); const c=Math.cos(f.heading),sn=Math.sin(f.heading),reach=Math.hypot(w,h)/2+cell*6; // Convert a fixed world point into the chair's reference frame. The chair stays centered and points up.
    function pt(wx,wy) {
      const dx=wx-f.worldX,dy=wy-f.worldY; return {
        x:cx+c*dx+sn*dy,y:cy-sn*dx+c*dy
      }
    }
    const radius=Math.ceil(reach/cell)+3,gxCenter=Math.floor(f.worldX/cell),gyCenter=Math.floor(f.worldY/cell),gxMin=gxCenter-radius,gxMax=gxCenter+radius,gyMin=gyCenter-radius,gyMax=gyCenter+radius; for(let gy=gyMin; gy<=gyMax; gy++)for(let gx=gxMin; gx<=gxMax; gx++) {
      const x0=gx*cell,y0=gy*cell,p0=pt(x0,y0),p1=pt(x0+cell,y0),p2=pt(x0+cell,y0+cell),p3=pt(x0,y0+cell); ctx.beginPath(); ctx.moveTo(p0.x,p0.y); ctx.lineTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y); ctx.lineTo(p3.x,p3.y); ctx.closePath(); ctx.fillStyle=((gx+gy)&1)?'#343a40':'#272c32'; ctx.fill(); ctx.strokeStyle='#4a5159'; ctx.lineWidth=1; ctx.stroke()
    }
    const markerStep=3,markerGxStart=Math.floor(gxMin/markerStep)*markerStep,markerGyStart=Math.floor(gyMin/markerStep)*markerStep; for(let gy=markerGyStart; gy<=gyMax; gy+=markerStep)for(let gx=markerGxStart; gx<=gxMax; gx+=markerStep) {
      const p=pt(gx*cell+cell/2,gy*cell+cell/2); if(p.x<-8||p.x>w+8||p.y<-8||p.y>h+8)continue; ctx.beginPath(); ctx.fillStyle=((((gx/markerStep)+(gy/markerStep))&1)===0)?'#8fa3ff':'#62c6a5'; ctx.arc(p.x,p.y,4,0,Math.PI*2); ctx.fill()
    }
    if(f.mapPath.length>1) {
      ctx.beginPath(); ctx.strokeStyle='#c7a6ff'; ctx.lineWidth=4; ctx.lineCap='round'; ctx.lineJoin='round'; f.mapPath.forEach((p,j)=> {
        const q=pt(p.x,p.y); j?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y)
      } ); ctx.stroke()
    }
    drawWheelchair(ctx,cx,cy,0,1.05)
  }
  function isStopped(i) {
    const o=interpret(state.slots[i]); return o.command==='stop'&&Math.abs(o.lin)<1e-9&&Math.abs(o.ang)<1e-9
  }
  function mapIsCentered(i) {
    const v=mapViews[i]; return Math.abs(v.panX)<.5&&Math.abs(v.panY)<.5&&Math.abs(v.zoom-1)<.001
  }
  function updateMapControls(card,i) {
    const v=mapViews[i],stopped=isStopped(i),button=card.querySelector('.recenter-map'),canvas=card.querySelector('.map-canvas'); if(button)button.disabled=!stopped||mapIsCentered(i); if(canvas)canvas.classList.toggle('pan-ready',stopped&&!v.dragging)
  }
  function recenterMap(i) {
    const v=mapViews[i]; v.panX=0; v.panY=0; v.zoom=1; v.dragging=false; v.pointerId=null; v.moved=false
  }
  function drawMap(card,i) {
    const canvas=card.querySelector('.map-canvas'); if(!canvas)return; const {
      ctx,w,h
    }
    =canvasSize(canvas),f=floorStates[i],v=mapViews[i],cx=w/2+v.panX,cy=h/2+v.panY,scale=.75*v.zoom; ctx.clearRect(0,0,w,h); ctx.fillStyle='#30343a'; ctx.fillRect(0,0,w,h); ctx.strokeStyle='#4b5159'; ctx.lineWidth=1; const grid=40*v.zoom; const originX=cx-f.worldX*scale,originY=cy-f.worldY*scale; for(let gx=((originX%grid)+grid)%grid; gx<w; gx+=grid) {
      ctx.beginPath(); ctx.moveTo(gx,0); ctx.lineTo(gx,h); ctx.stroke()
    }
    for(let gy=((originY%grid)+grid)%grid; gy<h; gy+=grid) {
      ctx.beginPath(); ctx.moveTo(0,gy); ctx.lineTo(w,gy); ctx.stroke()
    }
    if(f.mapPath.length>1) {
      ctx.beginPath(); ctx.strokeStyle='#62d49a'; ctx.lineWidth=Math.max(1.5,3*v.zoom); ctx.lineCap='round'; ctx.lineJoin='round'; f.mapPath.forEach((p,j)=> {
        const px=cx+(p.x-f.worldX)*scale,py=cy+(p.y-f.worldY)*scale; j?ctx.lineTo(px,py):ctx.moveTo(px,py)
      } ); ctx.stroke()
    }
    drawWheelchair(ctx,cx,cy,f.heading,.65*v.zoom); updateMapControls(card,i)
  }
  function attachMapEvents() {
    $$('.card').forEach((card,i)=> {
      const canvas=card.querySelector('.map-canvas'),button=card.querySelector('.recenter-map'),v=mapViews[i]; if(!canvas||!button)return; button.addEventListener('click',()=> {
        if(!isStopped(i))return; recenterMap(i); applyFloorState(card,i)
      } ); canvas.addEventListener('pointerdown',e=> {
        if(!isStopped(i))return; v.dragging=true; v.pointerId=e.pointerId; v.startX=e.clientX; v.startY=e.clientY; v.baseX=v.panX; v.baseY=v.panY; v.moved=false; canvas.setPointerCapture(e.pointerId); canvas.classList.add('panning'); canvas.classList.remove('pan-ready'); e.preventDefault()
      } ); canvas.addEventListener('pointermove',e=> {
        if(!v.dragging||e.pointerId!==v.pointerId)return; const dx=e.clientX-v.startX,dy=e.clientY-v.startY; if(!v.moved&&Math.hypot(dx,dy)<4)return; v.moved=true; v.panX=v.baseX+dx; v.panY=v.baseY+dy; applyFloorState(card,i); e.preventDefault()
      } ); const finish=e=> {
        if(!v.dragging||(e.pointerId!==undefined&&e.pointerId!==v.pointerId))return; v.dragging=false; v.pointerId=null; canvas.classList.remove('panning'); applyFloorState(card,i)
      } ; canvas.addEventListener('pointerup',finish); canvas.addEventListener('pointercancel',finish); canvas.addEventListener('wheel',e=> {
        if(!isStopped(i))return; e.preventDefault(); const rect=canvas.getBoundingClientRect(),mx=e.clientX-rect.left,my=e.clientY-rect.top,centerX=rect.width/2,centerY=rect.height/2,oldZoom=v.zoom,factor=Math.exp(-e.deltaY*.0015),newZoom=clamp(oldZoom*factor,.25,3); if(Math.abs(newZoom-oldZoom)<1e-6)return; const ratio=newZoom/oldZoom; v.panX=(mx-centerX)-(mx-centerX-v.panX)*ratio; v.panY=(my-centerY)-(my-centerY-v.panY)*ratio; v.zoom=newZoom; applyFloorState(card,i)
      } , {
        passive:false
      } ); canvas.addEventListener('dragstart',e=>e.preventDefault())
    } )
  }
  function applyFloorState(card,i) {
    drawOccupant(card,i); drawMap(card,i)
  }
  function motionLoop(ts) {
    if(lastMotionTime===null)lastMotionTime=ts; const dt=Math.min((ts-lastMotionTime)/1000,.05); lastMotionTime=ts; $$('.card').forEach((card,i)=> {
      const o=interpret(state.slots[i]),f=floorStates[i],inputMagnitude=Math.min(1,Math.hypot(x,y)); if(o.command!=='stop'||Math.abs(o.lin)>1e-9||Math.abs(o.ang)>1e-9) {
        if(!mapIsCentered(i)||mapViews[i].dragging)recenterMap(i)
      }
      if(Math.hypot(o.lin,o.ang)>.01) {
        const response=speed(inputMagnitude)/100,maxLinearSpeed=70,maxAngularSpeed=90*Math.PI/180; const linearVelocity=o.lin*maxLinearSpeed*response; const angularVelocity=o.ang*maxAngularSpeed*response; // Midpoint integration follows a circular arc while translating, and keeps x/y fixed during rotation in place.
        const dHeading=angularVelocity*dt,midHeading=f.heading+dHeading/2,dist=linearVelocity*dt; if(Math.abs(dist)>.0001) {
          f.worldX+=Math.sin(midHeading)*dist; f.worldY-=Math.cos(midHeading)*dist
        }
        f.heading+=dHeading; f.heading=Math.atan2(Math.sin(f.heading),Math.cos(f.heading)); if(Math.abs(dist)>.0001) {
          const last=f.mapPath[f.mapPath.length-1]; if(!last||Math.hypot(f.worldX-last.x,f.worldY-last.y)>1) {
            f.mapPath.push( {
              x:f.worldX,y:f.worldY
            } ); if(f.mapPath.length>5000)f.mapPath.shift()
          }
        }
      }
      applyFloorState(card,i)
    } ); motionRaf=requestAnimationFrame(motionLoop)
  }
  function render() {
    $$('.card').forEach((c,i)=> {
      const o=interpret(state.slots[i]); c.querySelector('.joy svg').innerHTML=drawMapping(state.slots[i]); const k=c.querySelector('.knob'); k.style.left=50+x*42+'%'; k.style.top=50+y*42+'%'; c.querySelector('.intent').innerHTML=`<strong>${safeText(o.label)}</strong><span>${safeText(o.sub)}</span>`; applyFloorState(c,i); c.querySelector('.description').textContent=o.desc
    } ); $('#rawReadout').textContent=(Math.abs(x)<.005&&Math.abs(y)<.005)?'centered':`X ${x.toFixed(2)}, Y ${(-y).toFixed(2)}`
  }
  function setPointer(e,j) {
    const r=j.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,rad=r.width*.42; let nx=(e.clientX-cx)/rad,ny=(e.clientY-cy)/rad,m=Math.hypot(nx,ny); if(m>1) {
      nx/=m; ny/=m
    }
    x=nx; y=ny; render()
  }
  function attachJoystickEvents() {
    $$('.joy').forEach(j=> {
      let dragging=false; j.addEventListener('pointerdown',e=> {
        dragging=true; j.setPointerCapture(e.pointerId); setPointer(e,j)
      } ); j.addEventListener('pointermove',e=> {
        if(dragging)setPointer(e,j)
      } ); j.addEventListener('pointerup',()=>dragging=false); j.addEventListener('keydown',e=> {
        if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key))return; e.preventDefault(); if(e.key===' ')x=y=0; if(e.key==='ArrowUp')y=clamp(y-.1); if(e.key==='ArrowDown')y=clamp(y+.1); if(e.key==='ArrowLeft')x=clamp(x-.1); if(e.key==='ArrowRight')x=clamp(x+.1); const m=Math.hypot(x,y); if(m>1) {
          x/=m; y/=m
        }
        render()
      } )
    } )
  }
  function buildEditor() {
    const s=state.slots[+$('#editSlot').value],editor=$('#sectorEditor'); if(!s.type) {
      editor.classList.add('hidden'); $('#editNotice').textContent='Continuous control has no sectors to edit.'; return
    }
    editor.classList.remove('hidden'); $('#editNotice').textContent=`${s.type} sectors`; for(const i of [...selected])if(i>=s.type)selected.delete(i); if(!selected.size)selected.add(0); const box=$('#sectorButtons'); box.innerHTML=''; s.labels.forEach((label,i)=> {
      const b=document.createElement('button'); b.type='button'; b.className='sector-button'+(selected.has(i)?' selected':''); b.textContent=`${label} · ${s.widths[i].toFixed(1)}°`; b.addEventListener('click',()=> {
        selected.has(i)?selected.delete(i):selected.add(i); buildEditor()
      } ); box.appendChild(b)
    } ); syncWidth(); const ae=$('#actionEditor'); ae.innerHTML=''; s.labels.forEach((label,i)=> {
      const row=document.createElement('div'); row.className='action-row'; const num=document.createElement('strong'); num.textContent='#'+(i+1); const ll=document.createElement('label'); ll.textContent='Participant label'; const inp=document.createElement('input'); inp.type='text'; inp.maxLength=24; inp.value=label; inp.addEventListener('input',()=> {
        s.labels[i]=inp.value.trim()||`Sector ${i+1}`; render(); updateSummary(); autoSave()
      } ); ll.appendChild(inp); const al=document.createElement('label'); al.textContent='Action'; const sel=document.createElement('select'); for(const [v,n] of actionOptions) {
        const o=document.createElement('option'); o.value=v; o.textContent=n; o.selected=v===s.actions[i]; sel.appendChild(o)
      }
      sel.addEventListener('change',()=> {
        s.actions[i]=sel.value; render(); updateSummary(); autoSave()
      } ); al.appendChild(sel); row.append(num,ll,al); ae.appendChild(row)
    } ); updateSummary()
  }
  function syncWidth() {
    const s=state.slots[+$('#editSlot').value]; if(!s?.type||!selected.size) {
      wid.disabled=true; $('#sectorWidthOutput').textContent='Select a sector'; return
    }
    wid.disabled=false; const avg=[...selected].reduce((a,i)=>a+s.widths[i],0)/selected.size; wid.value=Math.round(avg); $('#sectorWidthOutput').textContent=avg.toFixed(1)+'°'+(selected.size>1?' each':'')
  }
  const wid=$('#sectorWidth'); function resize(target) {
    const s=state.slots[+$('#editSlot').value]; if(!s?.type||!selected.size)return; const arr=s.widths,ids=[...selected],others=arr.map((_,i)=>i).filter(i=>!selected.has(i)); target=clamp(target,10,170); if(!others.length) {
      arr.fill(360/arr.length); buildEditor(); render(); autoSave(); return
    }
    const oldS=ids.reduce((a,i)=>a+arr[i],0),oldO=360-oldS; let newS=target*ids.length,maxS=360-10*others.length; if(newS>maxS) {
      target=maxS/ids.length; newS=maxS
    }
    ids.forEach(i=>arr[i]=target); const newO=360-newS,f=newO/oldO; others.forEach(i=>arr[i]=Math.max(10,arr[i]*f)); arr[others[others.length-1]]+=360-arr.reduce((a,b)=>a+b,0); buildEditor(); render(); autoSave()
  }
  function updateSummary() {
    const s=state.slots[+$('#editSlot').value]; if(!s?.type)return; $('#mappingSummary').innerHTML='<strong>Current mapping:</strong> '+s.labels.map((v,i)=>`${safeText(v)} → ${actionName(s.actions[i])} (${s.widths[i].toFixed(1)}°)`).join(' · ')
  }
  function getCustomPresets() {
    try {
      return JSON.parse(localStorage.getItem(PRESETS)||'{}')
    } catch {
      return {
      }
    }
  }
  function setCustomPresets(v) {
    localStorage.setItem(PRESETS,JSON.stringify(v))
  }
  function rebuildPresets() {
    const el=$('#presetSelect'),custom=getCustomPresets(); el.innerHTML='<optgroup label="Built-in"><option value="builtin:default">Default — 4 / 8 / Continuous</option><option value="builtin:sectorCompare">Sector comparison — 4 / 6 / 8</option></optgroup>'; const names=Object.keys(custom); if(names.length) {
      const g=document.createElement('optgroup'); g.label='Saved presets'; names.sort().forEach(name=> {
        const o=document.createElement('option'); o.value='custom:'+name; o.textContent=name; g.appendChild(o)
      } ); el.appendChild(g)
    }
  }
  function validateState(v) {
    if(!v||!Array.isArray(v.slots)||v.slots.length!==3)return false; if(!['linear','fine','stepped'].includes(v.speedResponse))return false; return v.slots.every(s=>s&&Number.isInteger(s.type)&&(s.type===0||(s.type>=4&&s.type<=8))&&(!s.type||(Array.isArray(s.widths)&&s.widths.length===s.type&&Array.isArray(s.labels)&&s.labels.length===s.type&&Array.isArray(s.actions)&&s.actions.length===s.type)))
  }
  function applyState(v,msg='Configuration loaded.') {
    if(!validateState(v)) {
      status('Configuration is not valid.',true); return
    }
    state=clone(v); delete state.turnStrength; $('#speedResponse').value=state.speedResponse; selected=new Set([0]); buildCards(); buildEditor(); render(); autoSave(); status(msg)
  }
  function autoSave() {
    localStorage.setItem(STORAGE,JSON.stringify(state))
  }
  function status(msg,bad=false) {
    const s=$('#saveStatus'); s.textContent=msg; s.style.color=bad?'var(--danger)':''; clearTimeout(status.t); status.t=setTimeout(()=> {
      s.textContent=''; s.style.color=''
    } ,3500)
  }
  $('#speedResponse').addEventListener('change',()=> {
    state.speedResponse=$('#speedResponse').value; render(); autoSave()
  } ); $('#editSlot').addEventListener('change',()=> {
    selected=new Set([0]); buildEditor()
  } ); wid.addEventListener('input',()=>resize(+wid.value)); $('#minusFive').addEventListener('click',()=>resize(+wid.value-5)); $('#plusFive').addEventListener('click',()=>resize(+wid.value+5)); $('#equalize').addEventListener('click',()=> {
    const s=state.slots[+$('#editSlot').value]; if(s?.type) {
      s.widths.fill(360/s.type); buildEditor(); render(); autoSave()
    }
  } ); $('#selectAll').addEventListener('click',()=> {
    const s=state.slots[+$('#editSlot').value]; if(s?.type) {
      selected=new Set(s.widths.map((_,i)=>i)); buildEditor()
    }
  } ); $('#clearSelection').addEventListener('click',()=> {
    selected.clear(); buildEditor()
  } ); $('#selectAlternating').addEventListener('click',()=> {
    const s=state.slots[+$('#editSlot').value]; if(s?.type) {
      selected=new Set(s.widths.map((_,i)=>i).filter(i=>i%2===0)); buildEditor()
    }
  } ); $('#resetLabelsActions').addEventListener('click',()=> {
    const s=state.slots[+$('#editSlot').value]; if(s?.type) {
      const d=defaults(s.type); s.labels=d.map(v=>v[0]); s.actions=d.map(v=>v[1]); buildEditor(); render(); autoSave()
    }
  } ); $('#participantView').addEventListener('click',()=> {
    $('#presenterPanel').classList.add('hidden'); $('#participantView').classList.add('active'); $('#presenterView').classList.remove('active')
  } ); $('#presenterView').addEventListener('click',()=> {
    $('#presenterPanel').classList.remove('hidden'); $('#presenterView').classList.add('active'); $('#participantView').classList.remove('active')
  } ); $('#centerButton').addEventListener('click',()=> {
    x=y=0; render()
  } ); $('#clearPathsButton').addEventListener('click',()=> {
    resetFloorStates(); $$('.card').forEach((c,i)=>applyFloorState(c,i)); status('Paths cleared.')
  } ); $('#saveBrowser').addEventListener('click',()=> {
    autoSave(); status('Configuration saved in this browser.')
  } ); $('#resetAll').addEventListener('click',()=> {
    if(confirm('Reset the explorer to the default 4 / 8 / Continuous configuration?')) {
      resetFloorStates(); applyState(baseState(),'Reset to default.')
    }
  } ); $('#applyPreset').addEventListener('click',()=> {
    const v=$('#presetSelect').value; if(v.startsWith('builtin:'))applyState(builtIns[v.split(':')[1]].state,'Built-in preset applied.'); else {
      const name=v.slice(7),p=getCustomPresets()[name]; if(p)applyState(p,'Preset applied: '+name)
    }
  } ); $('#savePreset').addEventListener('click',()=> {
    const name=prompt('Name this preset:'); if(!name?.trim())return; const p=getCustomPresets(); p[name.trim()]=clone(state); setCustomPresets(p); rebuildPresets(); $('#presetSelect').value='custom:'+name.trim(); status('Preset saved: '+name.trim())
  } ); $('#exportConfig').addEventListener('click',()=> {
    const blob=new Blob([JSON.stringify(state,null,2)], {
      type:'application/json'
    } ),a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='joystick-mapping-config.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); status('Configuration exported.')
  } ); $('#importConfig').addEventListener('change',async e=> {
    const f=e.target.files?.[0]; if(!f)return; try {
      const v=JSON.parse(await f.text()); applyState(v,'Configuration imported.')
    } catch {
      status('Could not read that JSON configuration.',true)
    }
    e.target.value=''
  } ); function pollGamepad() {
    if(!gamepadActive)return; const gs=navigator.getGamepads?navigator.getGamepads():[],g=[...gs].find(Boolean); if(g&&g.axes.length>=2) {
      x=Math.abs(g.axes[0])<.05?0:clamp(g.axes[0]); y=Math.abs(g.axes[1])<.05?0:clamp(g.axes[1]); $('#inputStatus').textContent='Physical controller: '+(g.id||'connected'); render()
    } else $('#inputStatus').textContent='Waiting for physical controller…'; raf=requestAnimationFrame(pollGamepad)
  }
  $('#gamepadButton').addEventListener('click',()=> {
    if(!navigator.getGamepads) {
      $('#inputStatus').textContent='Gamepad support unavailable in this browser.'; return
    }
    gamepadActive=!gamepadActive; $('#gamepadButton').textContent=gamepadActive?'Use on-screen only':'Use physical controller'; if(gamepadActive)pollGamepad(); else {
      if(raf)cancelAnimationFrame(raf); $('#inputStatus').textContent='On-screen joystick'
    }
  } ); rebuildPresets(); try {
    const saved=JSON.parse(localStorage.getItem(STORAGE)||'null'); if(validateState(saved))state=saved
  } catch {
  }
  delete state.turnStrength; $('#speedResponse').value=state.speedResponse; buildCards(); buildEditor(); render(); motionRaf=requestAnimationFrame(motionLoop);
} )();
