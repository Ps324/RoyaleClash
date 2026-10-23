(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('overlay');
  const startBtn = document.getElementById('startBtn');

  const W = canvas.width, H = canvas.height;
  const ARENA_H = 680, UI_Y = ARENA_H;
  const RIVER_Y = 340;
  const BRIDGES = [390, 890];
  const TEAM = { PLAYER: 0, ENEMY: 1 };
  const TAU = Math.PI * 2;

  const CARD_DEFS = [
    { id:'vanguard', name:'Vanguard', cost:3, kind:'unit', color:'#7ed7ff', hp:760, damage:92, speed:62, range:34, hit:1.0, radius:18, count:1, desc:'Reliable melee fighter.' },
    { id:'rangers', name:'Rangers', cost:3, kind:'unit', color:'#ffb4df', hp:250, damage:70, speed:55, range:155, hit:1.05, radius:13, count:2, spread:24, projectile:360, desc:'Two long-range attackers.' },
    { id:'colossus', name:'Colossus', cost:5, kind:'unit', color:'#d8b27c', hp:1900, damage:135, speed:34, range:34, hit:1.4, radius:25, count:1, buildingsOnly:true, desc:'Huge tank that targets towers.' },
    { id:'sprites', name:'Sprites', cost:2, kind:'unit', color:'#b7ff79', hp:105, damage:47, speed:82, range:27, hit:.72, radius:9, count:5, spread:28, desc:'Fast swarm with low health.' },
    { id:'sparkshot', name:'Sparkshot', cost:3, kind:'unit', color:'#ffb34e', hp:390, damage:118, speed:48, range:145, hit:1.35, radius:14, count:1, projectile:300, splash:58, desc:'Ranged splash attacker.' },
    { id:'raider', name:'Raider', cost:4, kind:'unit', color:'#90a5ff', hp:980, damage:155, speed:78, range:32, hit:1.15, radius:18, count:1, buildingsOnly:true, charge:true, desc:'Fast tower hunter.' },
    { id:'meteor', name:'Meteor', cost:4, kind:'spell', color:'#ff725f', spell:'meteor', radius:82, damage:360, towerDamage:175, desc:'Area damage anywhere.' },
    { id:'pulse', name:'Pulse', cost:2, kind:'spell', color:'#c890ff', spell:'pulse', radius:105, damage:105, towerDamage:55, stun:1.0, desc:'Wide stun and light damage.' }
  ];
  const CARD = Object.fromEntries(CARD_DEFS.map(c => [c.id, c]));
  const BASE_DECK = CARD_DEFS.map(c => c.id);

  let game;
  let muted = false;
  let audioCtx = null;
  let last = performance.now();
  let running = false;
  let pointer = { x:0, y:0, inside:false };

  function rand(a,b){ return a + Math.random()*(b-a); }
  function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
  function lerp(a,b,t){ return a+(b-a)*t; }
  function dist(a,b){ return Math.hypot(a.x-b.x,a.y-b.y); }
  function teamDir(team){ return team === TEAM.PLAYER ? -1 : 1; }
  function other(team){ return team === TEAM.PLAYER ? TEAM.ENEMY : TEAM.PLAYER; }
  function fmtTime(s){ s=Math.max(0,Math.ceil(s)); return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; }

  function tone(freq=440,dur=.06,type='square',gain=.025){
    if(muted) return;
    try{
      audioCtx ||= new (window.AudioContext||window.webkitAudioContext)();
      if(audioCtx.state==='suspended') audioCtx.resume();
      const o=audioCtx.createOscillator(), g=audioCtx.createGain();
      o.type=type; o.frequency.value=freq; g.gain.value=gain;
      o.connect(g); g.connect(audioCtx.destination); o.start();
      g.gain.exponentialRampToValueAtTime(.0001,audioCtx.currentTime+dur);
      o.stop(audioCtx.currentTime+dur);
    }catch(_){ }
  }

  function shuffle(arr){
    const a=[...arr];
    for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
    return a;
  }

  class Deck {
    constructor(){
      this.queue=shuffle(BASE_DECK);
      this.hand=this.queue.splice(0,4);
      this.next=this.queue[0];
    }
    play(slot){
      const used=this.hand[slot];
      this.hand[slot]=this.queue.shift();
      this.queue.push(used);
      this.next=this.queue[0];
      return used;
    }
  }

  class Tower {
    constructor(team,type,x,y){
      this.team=team; this.type=type; this.x=x; this.y=y;
      this.radius=type==='citadel'?34:27;
      this.maxHp=type==='citadel'?3200:2050;
      this.hp=this.maxHp; this.dead=false; this.cool=rand(0,.6); this.flash=0; this.stun=0;
      this.range=type==='citadel'?205:190; this.damage=type==='citadel'?105:86; this.hit=type==='citadel'?1.0:.9;
    }
    update(dt){
      if(this.dead) return;
      this.flash=Math.max(0,this.flash-dt*4); this.stun=Math.max(0,this.stun-dt);
      this.cool-=dt;
      if(this.stun>0 || this.cool>0) return;
      let target=null, best=Infinity;
      for(const u of game.units){
        if(u.dead||u.team===this.team) continue;
        const d=dist(this,u);
        if(d<=this.range && d<best){ best=d; target=u; }
      }
      if(target){
        this.cool=this.hit;
        game.projectiles.push(new Projectile(this.team,this.x,this.y-8*teamDir(this.team),target,this.damage,440,0,'tower'));
        tone(this.type==='citadel'?210:260,.035,'square',.012);
      }
    }
    hurt(amount,sourceTeam,stun=0){
      if(this.dead) return;
      this.hp-=amount; this.flash=1; this.stun=Math.max(this.stun,stun);
      game.effects.push(new FloatText(this.x,this.y-45,`-${Math.round(amount)}`,'#ffe3a1'));
      if(this.hp<=0){
        this.hp=0; this.dead=true;
        game.onTowerDestroyed(this,sourceTeam);
      }
    }
  }

  class Unit {
    constructor(team,def,x,y,offset=0){
      this.team=team; this.def=def; this.x=x+offset; this.y=y; this.radius=def.radius;
      this.maxHp=def.hp; this.hp=def.hp; this.dead=false; this.cool=rand(0,.25); this.stun=0; this.flash=0;
      this.bridgeX = Math.abs(this.x-BRIDGES[0]) < Math.abs(this.x-BRIDGES[1]) ? BRIDGES[0] : BRIDGES[1];
      this.charge=def.charge?0:1; this.facing=teamDir(team); this.wobble=Math.random()*TAU;
    }
    update(dt){
      if(this.dead) return;
      this.flash=Math.max(0,this.flash-dt*6); this.stun=Math.max(0,this.stun-dt); this.cool-=dt;
      if(this.stun>0) return;

      const target=this.findTarget();
      if(!target) return;
      const d=dist(this,target)-this.radius-(target.radius||0);
      if(d<=this.def.range){
        if(this.cool<=0){ this.attack(target); this.cool=this.def.hit; }
        return;
      }
      this.moveToward(target,dt);
    }
    findTarget(){
      let best=null,bestScore=Infinity;
      if(!this.def.buildingsOnly){
        for(const u of game.units){
          if(u.dead||u.team===this.team) continue;
          const d=dist(this,u);
          if(d<185 && d<bestScore){ best=u; bestScore=d; }
        }
      }
      if(best) return best;
      for(const t of game.towers){
        if(t.dead||t.team===this.team) continue;
        const d=dist(this,t);
        if(d<bestScore){ best=t; bestScore=d; }
      }
      return best;
    }
    moveToward(target,dt){
      let tx=target.x, ty=target.y;
      const across=(this.y<RIVER_Y)!==(target.y<RIVER_Y);
      const inBridge=Math.abs(this.x-this.bridgeX)<52;
      if(across && !inBridge && Math.abs(this.y-RIVER_Y)<165){
        tx=this.bridgeX; ty=this.team===TEAM.PLAYER?RIVER_Y+46:RIVER_Y-46;
      } else if(across && inBridge){
        tx=this.bridgeX; ty=this.team===TEAM.PLAYER?RIVER_Y-62:RIVER_Y+62;
      }
      let dx=tx-this.x,dy=ty-this.y,d=Math.hypot(dx,dy)||1;
      const speed=this.def.speed*(this.def.charge ? (this.charge>1.1?1.45:1) : 1);
      this.x+=dx/d*speed*dt; this.y+=dy/d*speed*dt;
      this.facing=Math.sign(dx)||this.facing;
      if(this.def.charge) this.charge=Math.min(1.6,this.charge+dt*.32);
      this.x=clamp(this.x,45,W-45); this.y=clamp(this.y,35,ARENA_H-35);
    }
    attack(target){
      let dmg=this.def.damage;
      if(this.def.charge && this.charge>1.25){ dmg*=1.75; this.charge=0; tone(125,.08,'sawtooth',.02); }
      if(this.def.projectile){
        game.projectiles.push(new Projectile(this.team,this.x,this.y,target,dmg,this.def.projectile,this.def.splash||0,this.def.id));
      }else{
        hitTarget(target,dmg,this.team,0,this.def.splash||0,this.x,this.y);
        game.effects.push(new Slash(this.x,this.y,target.x,target.y,this.team));
      }
      tone(this.def.projectile?350:170,.025,'square',.009);
    }
    hurt(amount,sourceTeam,stun=0){
      if(this.dead) return;
      this.hp-=amount; this.flash=1; this.stun=Math.max(this.stun,stun);
      if(this.hp<=0){ this.hp=0; this.dead=true; game.effects.push(new Burst(this.x,this.y,this.def.color,7)); }
    }
  }

  class Projectile {
    constructor(team,x,y,target,damage,speed,splash=0,style='shot'){
      this.team=team;this.x=x;this.y=y;this.target=target;this.damage=damage;this.speed=speed;this.splash=splash;this.style=style;this.dead=false;
    }
    update(dt){
      if(this.dead) return;
      if(!this.target || this.target.dead){ this.dead=true; return; }
      const dx=this.target.x-this.x,dy=this.target.y-this.y,d=Math.hypot(dx,dy)||1;
      if(d<this.speed*dt+10){
        const tx=this.target.x,ty=this.target.y;
        hitTarget(this.target,this.damage,this.team,0,this.splash,tx,ty);
        game.effects.push(new Burst(tx,ty,this.style==='sparkshot'?'#ffbe55':'#f4f1ff',this.splash?8:4));
        this.dead=true; return;
      }
      this.x+=dx/d*this.speed*dt; this.y+=dy/d*this.speed*dt;
    }
  }

  class Burst {
    constructor(x,y,color,n=6){ this.x=x;this.y=y;this.color=color;this.t=.45;this.parts=Array.from({length:n},()=>({a:rand(0,TAU),s:rand(25,100),r:rand(2,5)})); }
    update(dt){this.t-=dt;}
    draw(){
      const q=clamp(this.t/.45,0,1); ctx.save(); ctx.globalAlpha=q;
      for(const p of this.parts){ const d=(1-q)*p.s; ctx.fillStyle=this.color; ctx.beginPath(); ctx.arc(this.x+Math.cos(p.a)*d,this.y+Math.sin(p.a)*d,p.r*q,0,TAU);ctx.fill(); }
      ctx.restore();
    }
  }
  class Slash {
    constructor(x,y,tx,ty,team){this.x=x;this.y=y;this.tx=tx;this.ty=ty;this.team=team;this.t=.16;}
    update(dt){this.t-=dt;}
    draw(){ctx.save();ctx.globalAlpha=clamp(this.t/.16,0,1);ctx.strokeStyle=this.team===TEAM.PLAYER?'#aeeaff':'#ffb3b3';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(this.x,this.y);ctx.lineTo(this.tx,this.ty);ctx.stroke();ctx.restore();}
  }
  class FloatText {
    constructor(x,y,text,color='#fff'){this.x=x;this.y=y;this.text=text;this.color=color;this.t=.8;}
    update(dt){this.t-=dt;this.y-=18*dt;}
    draw(){ctx.save();ctx.globalAlpha=clamp(this.t/.8,0,1);ctx.fillStyle=this.color;ctx.font='700 14px system-ui';ctx.textAlign='center';ctx.fillText(this.text,this.x,this.y);ctx.restore();}
  }
  class Ring {
    constructor(x,y,r,color){this.x=x;this.y=y;this.r=r;this.color=color;this.t=.45;}
    update(dt){this.t-=dt;}
    draw(){const q=1-clamp(this.t/.45,0,1);ctx.save();ctx.globalAlpha=1-q;ctx.strokeStyle=this.color;ctx.lineWidth=lerp(8,2,q);ctx.beginPath();ctx.arc(this.x,this.y,this.r*q,0,TAU);ctx.stroke();ctx.restore();}
  }

  function hitTarget(target,damage,sourceTeam,stun=0,splash=0,x=0,y=0){
    target.hurt(damage,sourceTeam,stun);
    if(splash>0){
      for(const u of game.units){
        if(u.dead||u===target||u.team===sourceTeam) continue;
        if(Math.hypot(u.x-x,u.y-y)<=splash) u.hurt(damage*.65,sourceTeam,stun);
      }
    }
  }

  function createTowers(){
    return [
      new Tower(TEAM.ENEMY,'citadel',640,72),
      new Tower(TEAM.ENEMY,'guard',390,165), new Tower(TEAM.ENEMY,'guard',890,165),
      new Tower(TEAM.PLAYER,'guard',390,515), new Tower(TEAM.PLAYER,'guard',890,515),
      new Tower(TEAM.PLAYER,'citadel',640,608)
    ];
  }

  function newGame(){
    game={
      units:[], projectiles:[], effects:[], towers:createTowers(),
      decks:[new Deck(),new Deck()], elixir:[5,5], selected:null,
      time:180, overtime:false, over:false, winner:null, crowns:[0,0],
      aiThink:1.0, message:'Battle!', messageT:1.5, lastTowerKill:null
    };
    last=performance.now();
  }

  function spawnCard(team,cardId,x,y,slot=null){
    const def=CARD[cardId];
    if(!def) return false;
    if(game.elixir[team]+1e-6<def.cost) return false;
    if(def.kind==='unit'){
      const legal=team===TEAM.PLAYER ? y>RIVER_Y+34 : y<RIVER_Y-34;
      if(!legal) return false;
      const offsets=[];
      for(let i=0;i<def.count;i++) offsets.push((i-(def.count-1)/2)*(def.spread||18));
      offsets.forEach((off,i)=>game.units.push(new Unit(team,def,x,y+(i%2)*8,off)));
    }else{
      castSpell(team,def,x,y);
    }
    game.elixir[team]-=def.cost;
    if(slot!==null) game.decks[team].play(slot);
    tone(520,.05,'triangle',.015);
    return true;
  }

  function castSpell(team,def,x,y){
    game.effects.push(new Ring(x,y,def.radius,def.color));
    if(def.spell==='meteor'){
      game.effects.push(new Burst(x,y,'#ff8a5d',18));
      for(const u of game.units){ if(!u.dead&&u.team!==team&&Math.hypot(u.x-x,u.y-y)<=def.radius) u.hurt(def.damage,team,0); }
      for(const t of game.towers){ if(!t.dead&&t.team!==team&&Math.hypot(t.x-x,t.y-y)<=def.radius+t.radius) t.hurt(def.towerDamage,team,0); }
      tone(80,.18,'sawtooth',.035);
    }else{
      for(const u of game.units){ if(!u.dead&&u.team!==team&&Math.hypot(u.x-x,u.y-y)<=def.radius) u.hurt(def.damage,team,def.stun); }
      for(const t of game.towers){ if(!t.dead&&t.team!==team&&Math.hypot(t.x-x,t.y-y)<=def.radius+t.radius) t.hurt(def.towerDamage,team,def.stun*.6); }
      tone(620,.12,'square',.018);
    }
  }

  function aiUpdate(dt){
    game.aiThink-=dt;
    if(game.aiThink>0||game.over) return;
    game.aiThink=rand(.65,1.3);
    const deck=game.decks[TEAM.ENEMY];
    const affordable=deck.hand.map((id,i)=>({id,i,def:CARD[id]})).filter(o=>o.def.cost<=game.elixir[TEAM.ENEMY]+.001);
    if(!affordable.length) return;

    let pick=null,x=BRIDGES[Math.random()<.5?0:1],y=rand(85,RIVER_Y-70);
    const dangerous=game.units.filter(u=>!u.dead&&u.team===TEAM.PLAYER&&u.y<RIVER_Y+120);
    const spellChoices=affordable.filter(o=>o.def.kind==='spell');
    if(dangerous.length>=3&&spellChoices.length){
      pick=spellChoices[Math.floor(Math.random()*spellChoices.length)];
      const target=dangerous.reduce((a,b)=>a.y<b.y?a:b); x=target.x; y=target.y;
    }else{
      const troops=affordable.filter(o=>o.def.kind==='unit');
      pick=(troops.length?troops:affordable)[Math.floor(Math.random()*(troops.length?troops.length:affordable.length))];
      const weakTower=game.towers.filter(t=>t.team===TEAM.PLAYER&&!t.dead&&t.type==='guard').sort((a,b)=>a.hp-b.hp)[0];
      if(weakTower) x=weakTower.x+rand(-45,45);
      y=rand(105,RIVER_Y-62);
    }
    if(pick) spawnCard(TEAM.ENEMY,pick.id,clamp(x,80,W-80),clamp(y,55,RIVER_Y-45),pick.i);
  }

  function update(dt){
    if(!running||game.over) return;
    const mult=game.time<=60?2:1;
    game.elixir[0]=Math.min(10,game.elixir[0]+dt*.36*mult);
    game.elixir[1]=Math.min(10,game.elixir[1]+dt*.36*mult);

    game.time-=dt;
    if(game.time<=0){
      if(!game.overtime && game.crowns[0]===game.crowns[1]){
        game.overtime=true; game.time=60; game.message='OVERTIME — sudden death'; game.messageT=2.2; tone(130,.28,'sawtooth',.025);
      }else finishByScore();
    }

    aiUpdate(dt);
    game.towers.forEach(t=>t.update(dt));
    game.units.forEach(u=>u.update(dt));
    game.projectiles.forEach(p=>p.update(dt));
    game.effects.forEach(e=>e.update(dt));

    separateUnits();
    game.units=game.units.filter(u=>!u.dead);
    game.projectiles=game.projectiles.filter(p=>!p.dead);
    game.effects=game.effects.filter(e=>e.t>0);
    game.messageT=Math.max(0,game.messageT-dt);
  }

  function separateUnits(){
    const us=game.units;
    for(let i=0;i<us.length;i++) for(let j=i+1;j<us.length;j++){
      const a=us[i],b=us[j]; if(a.team!==b.team) continue;
      let dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||.01,min=(a.radius+b.radius)*.65;
      if(d<min){ const push=(min-d)*.08; dx/=d;dy/=d; a.x-=dx*push;a.y-=dy*push;b.x+=dx*push;b.y+=dy*push; }
    }
  }

  function finishByScore(){
    if(game.over) return;
    if(game.crowns[0]!==game.crowns[1]) return endGame(game.crowns[0]>game.crowns[1]?TEAM.PLAYER:TEAM.ENEMY);
    const hp=team=>game.towers.filter(t=>t.team===team&&!t.dead).reduce((s,t)=>s+t.hp,0);
    const p=hp(TEAM.PLAYER),e=hp(TEAM.ENEMY);
    if(Math.abs(p-e)<1) endGame(null); else endGame(p>e?TEAM.PLAYER:TEAM.ENEMY);
  }

  function endGame(winner){
    game.over=true; game.winner=winner; game.selected=null;
    tone(winner===TEAM.PLAYER?660:110,.38,winner===TEAM.PLAYER?'triangle':'sawtooth',.035);
  }

  function onTowerDestroyed(tower,sourceTeam){
    const value=tower.type==='citadel'?3:1;
    game.crowns[sourceTeam]=tower.type==='citadel'?3:Math.min(3,game.crowns[sourceTeam]+value);
    game.effects.push(new Burst(tower.x,tower.y,'#ffd467',28));
    game.effects.push(new FloatText(tower.x,tower.y-55,'TOWER DOWN!','#ffd86a'));
    game.lastTowerKill={team:sourceTeam,type:tower.type};
    tone(65,.3,'sawtooth',.05);
    if(tower.type==='citadel') endGame(sourceTeam);
    else if(game.overtime) endGame(sourceTeam);
  }

  function installGameMethods(){ game.onTowerDestroyed=onTowerDestroyed; }

  function draw(){
    drawArena();
    drawTowers();
    drawUnits();
    drawProjectiles();
    game.effects.forEach(e=>e.draw&&e.draw());
    drawHUD();
    if(game.selected!==null) drawPlacementPreview();
    if(game.messageT>0) drawMessage(game.message);
    if(game.over) drawEnd();
  }

  function drawArena(){
    ctx.clearRect(0,0,W,H);
    const top=ctx.createLinearGradient(0,0,0,RIVER_Y-31);
    top.addColorStop(0,'#694148');top.addColorStop(1,'#845159');
    ctx.fillStyle=top;ctx.fillRect(0,0,W,RIVER_Y-31);
    const bottom=ctx.createLinearGradient(0,RIVER_Y+31,0,ARENA_H);
    bottom.addColorStop(0,'#3f6551');bottom.addColorStop(1,'#4c7a60');
    ctx.fillStyle=bottom;ctx.fillRect(0,RIVER_Y+31,W,ARENA_H-RIVER_Y-31);
    // Enemy ground: diagonal stone markings.
    for(let y=22;y<RIVER_Y-31;y+=30){
      ctx.strokeStyle='rgba(255,235,225,.09)';ctx.lineWidth=2;
      for(let x=-40+(y%60);x<W+40;x+=44){
        ctx.beginPath();ctx.moveTo(x,y+10);ctx.lineTo(x+18,y-8);ctx.stroke();
      }
    }
    // Friendly ground: soft grassy dot texture.
    for(let y=RIVER_Y+46;y<ARENA_H;y+=34){
      for(let x=18+((Math.floor(y/34)%2)*18);x<W;x+=36){
        ctx.fillStyle='rgba(233,255,235,.09)';
        ctx.beginPath();ctx.arc(x,y,3,0,TAU);ctx.fill();
      }
    }
    ctx.fillStyle='#2c79a6';ctx.fillRect(0,RIVER_Y-31,W,62);
    for(let x=-30;x<W;x+=95){
      ctx.beginPath();ctx.arc(x,RIVER_Y-8,30,0,Math.PI);
      ctx.strokeStyle='rgba(220,250,255,.22)';ctx.lineWidth=3;ctx.stroke();
    }
    ctx.strokeStyle='rgba(255,255,255,.15)';ctx.lineWidth=1.5;
    for(let x=-20;x<W+40;x+=52){
      ctx.beginPath();ctx.moveTo(x,RIVER_Y+12);
      ctx.quadraticCurveTo(x+18,RIVER_Y+2,x+36,RIVER_Y+12);ctx.stroke();
    }
    for(const bx of BRIDGES){
      ctx.fillStyle='#a8865d';ctx.fillRect(bx-55,RIVER_Y-39,110,78);
      ctx.strokeStyle='#5d422c';ctx.lineWidth=5;ctx.strokeRect(bx-55,RIVER_Y-39,110,78);
      ctx.fillStyle='rgba(70,43,25,.18)';
      for(let xx=bx-49;xx<bx+50;xx+=18)ctx.fillRect(xx,RIVER_Y-35,10,70);
      ctx.strokeStyle='rgba(255,255,255,.18)';ctx.lineWidth=2;
      for(let xx=bx-40;xx<bx+50;xx+=22){
        ctx.beginPath();ctx.moveTo(xx,RIVER_Y-34);
        ctx.lineTo(xx,RIVER_Y+34);ctx.stroke();
      }
    }
    ctx.fillStyle='rgba(87,150,221,.08)';ctx.fillRect(0,RIVER_Y+31,W,ARENA_H-RIVER_Y-31);
    ctx.fillStyle='rgba(223,75,80,.09)';ctx.fillRect(0,0,W,RIVER_Y-31);
    ctx.strokeStyle='rgba(255,255,255,.13)';ctx.setLineDash([8,10]);
    ctx.beginPath();ctx.moveTo(0,RIVER_Y);ctx.lineTo(W,RIVER_Y);ctx.stroke();ctx.setLineDash([]);
    ctx.fillStyle='#171326';ctx.fillRect(0,UI_Y,W,H-UI_Y);
    ctx.fillStyle='#251b36';ctx.fillRect(0,UI_Y,W,4);
  }

  function teamColor(team){return team===TEAM.PLAYER?'#4da3ff':'#ff6268';}
  function teamLight(team){return team===TEAM.PLAYER?'#dff1ff':'#ffe1e3';}
  function teamDark(team){return team===TEAM.PLAYER?'#1f4f86':'#8d2934';}

  function drawTowers(){
    for(const t of game.towers){
      if(t.dead){
        ctx.fillStyle='rgba(30,22,18,.45)';ctx.beginPath();
        ctx.ellipse(t.x,t.y+12,t.radius+14,15,0,0,TAU);ctx.fill();continue;
      }
      ctx.save();ctx.translate(t.x,t.y);
      ctx.fillStyle='rgba(0,0,0,.22)';ctx.beginPath();
      ctx.ellipse(0,19,t.radius+12,13,0,0,TAU);ctx.fill();
      ctx.fillStyle=t.flash>0?'#fff4dc':teamColor(t.team);
      ctx.strokeStyle=teamDark(t.team);ctx.lineWidth=5;
      if(t.type==='citadel'){
        roundRect(-34,-31,68,62,12);ctx.fill();ctx.stroke();
        ctx.fillStyle=teamLight(t.team);ctx.fillRect(-20,-39,40,13);
        ctx.fillStyle='rgba(255,255,255,.18)';ctx.fillRect(-28,-22,56,10);
        ctx.fillStyle='#2b1f3a';ctx.beginPath();ctx.arc(0,-3,13,0,TAU);ctx.fill();
        ctx.fillStyle=teamDark(t.team);ctx.beginPath();
        ctx.moveTo(-10,14);ctx.lineTo(0,2);ctx.lineTo(10,14);ctx.closePath();ctx.fill();
      }else{
        roundRect(-27,-27,54,54,10);ctx.fill();ctx.stroke();
        ctx.fillStyle=teamLight(t.team);ctx.fillRect(-14,-34,28,11);
        ctx.fillStyle='rgba(255,255,255,.18)';ctx.fillRect(-20,-18,40,8);
        ctx.fillStyle='#2b1f3a';ctx.beginPath();ctx.arc(0,-3,9,0,TAU);ctx.fill();
        ctx.fillStyle=teamDark(t.team);ctx.beginPath();
        ctx.moveTo(-8,12);ctx.lineTo(0,4);ctx.lineTo(8,12);ctx.closePath();ctx.fill();
      }
      ctx.restore();
      drawHealth(t.x,t.y-(t.type==='citadel'?52:44),t.hp/t.maxHp,t.type==='citadel'?76:62);
    }
  }

  function roundRect(x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r);}

  function drawUnits(){
    const sorted=[...game.units].sort((a,b)=>a.y-b.y);
    for(const u of sorted){
      ctx.save();ctx.translate(u.x,u.y);
      ctx.fillStyle='rgba(0,0,0,.24)';ctx.beginPath();
      ctx.ellipse(0,u.radius*.72,u.radius*1.05,u.radius*.45,0,0,TAU);ctx.fill();
      // Thick team ring is distinct even when unit types have similar colors.
      ctx.fillStyle=teamColor(u.team);ctx.beginPath();
      ctx.arc(0,0,u.radius+4,0,TAU);ctx.fill();
      ctx.fillStyle=u.flash>0?'#fff9e8':u.def.color;
      ctx.strokeStyle=teamLight(u.team);ctx.lineWidth=3;
      ctx.beginPath();ctx.arc(0,0,Math.max(5,u.radius-2),0,TAU);ctx.fill();ctx.stroke();
      ctx.fillStyle='rgba(255,255,255,.18)';ctx.beginPath();
      ctx.arc(-u.radius*.2,-u.radius*.28,Math.max(4,u.radius*.38),0,TAU);ctx.fill();
      ctx.fillStyle='#21192c';ctx.beginPath();
      ctx.arc(u.radius*.24,-u.radius*.16,Math.max(2,u.radius*.14),0,TAU);ctx.fill();
      ctx.strokeStyle=teamDark(u.team);ctx.lineWidth=2.5;ctx.beginPath();
      ctx.moveTo(-u.radius*.25,u.radius*.25);ctx.lineTo(u.radius*.28,u.radius*.25);ctx.stroke();
      // Allies have an arrow marker; enemies have a square/diamond.
      ctx.fillStyle=teamLight(u.team);
      if(u.team===TEAM.PLAYER){
        ctx.beginPath();ctx.moveTo(0,-u.radius*.9);
        ctx.lineTo(u.radius*.35,-u.radius*.35);ctx.lineTo(0,u.radius*.15);
        ctx.lineTo(-u.radius*.35,-u.radius*.35);ctx.closePath();ctx.fill();
      }else{
        ctx.save();ctx.translate(0,-u.radius*.42);ctx.rotate(Math.PI/4);
        ctx.fillRect(-u.radius*.22,-u.radius*.22,u.radius*.44,u.radius*.44);
        ctx.restore();
      }
      if(u.def.buildingsOnly){
        ctx.strokeStyle='#ffe38b';ctx.lineWidth=3;ctx.beginPath();
        ctx.moveTo(-u.radius*.55,u.radius*.1);
        ctx.lineTo(u.radius*.55,-u.radius*.45);ctx.stroke();
      }
      if(u.def.projectile){
        ctx.fillStyle='#fff5c1';ctx.beginPath();
        ctx.arc(u.radius*.42,u.radius*.28,Math.max(2,u.radius*.16),0,TAU);ctx.fill();
      }
      if(u.def.id==='sprites'){
        ctx.fillStyle='rgba(255,255,255,.75)';
        ctx.fillRect(-u.radius*.8,-u.radius*.15,u.radius*.28,2);
        ctx.fillRect(u.radius*.5,-u.radius*.15,u.radius*.28,2);
      }
      ctx.restore();
      drawHealth(u.x,u.y-u.radius-12,u.hp/u.maxHp,Math.max(28,u.radius*2.2),4);
      if(u.stun>0){
        ctx.strokeStyle='#d6a8ff';ctx.lineWidth=2;ctx.beginPath();
        ctx.arc(u.x,u.y-u.radius-7,u.radius*.65,Math.PI,TAU);ctx.stroke();
      }
    }
  }

  function drawProjectiles(){
    for(const p of game.projectiles){
      ctx.fillStyle=p.style==='sparkshot'?'#ffcf6d':p.style==='tower'?'#f3efff':'#fff';ctx.beginPath();ctx.arc(p.x,p.y,p.splash?7:5,0,TAU);ctx.fill();
    }
  }

  function drawHealth(x,y,p,w,h=7){
    p=clamp(p,0,1);ctx.fillStyle='rgba(18,13,24,.78)';roundRect(x-w/2,y,w,h,h/2);ctx.fill();ctx.fillStyle=p>.55?'#70e276':p>.25?'#ffd35c':'#ff6868';roundRect(x-w/2+1,y+1,(w-2)*p,h-2,(h-2)/2);ctx.fill();
  }

  function drawHUD(){
    ctx.fillStyle='#f4ebff';ctx.font='800 20px system-ui';ctx.textAlign='center';ctx.fillText(game.overtime?`OVERTIME ${fmtTime(game.time)}`:fmtTime(game.time),W/2,31);
    ctx.font='700 15px system-ui';ctx.fillStyle='#bcd7ff';ctx.fillText(`YOU  ${'◆'.repeat(game.crowns[0])}${'◇'.repeat(3-game.crowns[0])}`,150,31);
    ctx.fillStyle='#ffc0c3';ctx.fillText(`${'◆'.repeat(game.crowns[1])}${'◇'.repeat(3-game.crowns[1])}  AI`,W-150,31);
    if(game.time<=60 && !game.overtime){ctx.fillStyle='#ffdf7c';ctx.font='800 13px system-ui';ctx.fillText('DOUBLE ELIXIR',W/2,52);}

    const hand=game.decks[TEAM.PLAYER].hand;
    const cardW=185,cardH=122,gap=12,total=cardW*4+gap*3,start=(W-total)/2;
    for(let i=0;i<4;i++) drawCard(start+i*(cardW+gap),UI_Y+26,cardW,cardH,i,hand[i]);
    drawElixir(42,UI_Y+32);
    ctx.fillStyle='#ad9dbe';ctx.font='600 11px system-ui';ctx.textAlign='left';ctx.fillText(`NEXT: ${CARD[game.decks[0].next].name}`,43,H-18);
  }

  function drawCard(x,y,w,h,slot,id){
    const d=CARD[id],sel=game.selected===slot,can=game.elixir[0]>=d.cost;
    ctx.save();ctx.globalAlpha=can?1:.56;ctx.fillStyle=sel?'#3b2d5b':'#241b35';ctx.strokeStyle=sel?'#ffd86a':'#4a3b62';ctx.lineWidth=sel?4:2;roundRect(x,y,w,h,14);ctx.fill();ctx.stroke();
    ctx.fillStyle=d.color;roundRect(x+10,y+10,w-20,56,10);ctx.fill();
    ctx.fillStyle='rgba(20,13,29,.55)';ctx.beginPath();ctx.arc(x+30,y+29,17,0,TAU);ctx.fill();ctx.fillStyle='#fff';ctx.font='900 16px system-ui';ctx.textAlign='center';ctx.fillText(d.cost,x+30,y+35);
    ctx.fillStyle='#fff';ctx.font='800 16px system-ui';ctx.textAlign='left';ctx.fillText(d.name,x+13,y+88);ctx.fillStyle='#bbaecb';ctx.font='600 10px system-ui';ctx.fillText(d.kind==='spell'?'SPELL':d.buildingsOnly?'TOWER HUNTER':'TROOP',x+13,y+106);
    ctx.fillStyle='#8e80a0';ctx.font='800 12px system-ui';ctx.textAlign='right';ctx.fillText(String(slot+1),x+w-13,y+106);ctx.restore();
  }

  function drawElixir(x,y){
    ctx.fillStyle='#a3f';ctx.font='900 22px system-ui';ctx.textAlign='left';ctx.fillText(`${game.elixir[0].toFixed(1)}`,x,y+19);
    const bx=x,by=y+31,bw=126,bh=15;ctx.fillStyle='#332344';roundRect(bx,by,bw,bh,8);ctx.fill();ctx.fillStyle='#a947ef';roundRect(bx+2,by+2,(bw-4)*(game.elixir[0]/10),bh-4,6);ctx.fill();
    for(let i=1;i<10;i++){ctx.fillStyle='rgba(255,255,255,.16)';ctx.fillRect(bx+i*bw/10,by+2,1,bh-4)}
  }

  function drawPlacementPreview(){
    const id=game.decks[0].hand[game.selected],d=CARD[id];
    if(pointer.y>ARENA_H||!pointer.inside) return;
    const legal=d.kind==='spell'||pointer.y>RIVER_Y+34;
    ctx.save();ctx.globalAlpha=.35;ctx.fillStyle=legal?d.color:'#ff4d5d';ctx.beginPath();ctx.arc(pointer.x,pointer.y,d.kind==='spell'?d.radius:Math.max(26,d.radius*1.5),0,TAU);ctx.fill();ctx.restore();
  }

  function drawMessage(text){
    ctx.save();ctx.globalAlpha=clamp(game.messageT,.0,1);ctx.fillStyle='rgba(18,12,28,.78)';roundRect(W/2-210,290,420,62,14);ctx.fill();ctx.strokeStyle='#69527f';ctx.stroke();ctx.fillStyle='#fff0ba';ctx.font='900 25px system-ui';ctx.textAlign='center';ctx.fillText(text,W/2,329);ctx.restore();
  }

  function drawEnd(){
    ctx.fillStyle='rgba(8,6,13,.73)';ctx.fillRect(0,0,W,ARENA_H);
    ctx.fillStyle='#fff';ctx.font='900 52px system-ui';ctx.textAlign='center';const text=game.winner===TEAM.PLAYER?'VICTORY':game.winner===TEAM.ENEMY?'DEFEAT':'DRAW';ctx.fillText(text,W/2,286);
    ctx.font='700 20px system-ui';ctx.fillStyle='#d0c3df';ctx.fillText(`${game.crowns[0]} – ${game.crowns[1]} crowns`,W/2,326);
    ctx.font='700 16px system-ui';ctx.fillStyle='#ffe38b';ctx.fillText('Press R or click to restart',W/2,365);
  }

  function cardSlotAt(x,y){
    if(y<UI_Y+20) return -1;
    const w=185,gap=12,total=w*4+gap*3,start=(W-total)/2;
    for(let i=0;i<4;i++) if(x>=start+i*(w+gap)&&x<=start+i*(w+gap)+w&&y<=UI_Y+26+122) return i;
    return -1;
  }

  function canvasPos(ev){
    const r=canvas.getBoundingClientRect();return {x:(ev.clientX-r.left)*W/r.width,y:(ev.clientY-r.top)*H/r.height};
  }

  canvas.addEventListener('pointermove',ev=>{pointer={...canvasPos(ev),inside:true};});
  canvas.addEventListener('pointerleave',()=>pointer.inside=false);
  canvas.addEventListener('contextmenu',ev=>{ev.preventDefault();game.selected=null;});
  canvas.addEventListener('pointerdown',ev=>{
    if(!running){startBattle();return;}
    if(game.over){newGame();installGameMethods();return;}
    const p=canvasPos(ev);const slot=cardSlotAt(p.x,p.y);
    if(slot>=0){game.selected=game.selected===slot?null:slot;tone(480,.025,'triangle',.008);return;}
    if(game.selected!==null&&p.y<ARENA_H){
      const id=game.decks[0].hand[game.selected],def=CARD[id];
      const played=spawnCard(TEAM.PLAYER,id,p.x,p.y,game.selected);
      if(played) game.selected=null; else {tone(95,.05,'square',.012);game.message=game.elixir[0]<def.cost?'Not enough elixir':'Deploy troops on your side';game.messageT=.9;}
    }
  });

  window.addEventListener('keydown',ev=>{
    if(ev.code==='KeyM'){muted=!muted;return;}
    if(ev.code==='KeyR'){newGame();installGameMethods();running=true;overlay.hidden=true;return;}
    if(ev.code==='Escape'){game.selected=null;return;}
    if(['Digit1','Digit2','Digit3','Digit4'].includes(ev.code)){game.selected=Number(ev.code.slice(-1))-1;return;}
    if(!running && (ev.code==='Enter'||ev.code==='Space')) startBattle();
  });

  function startBattle(){running=true;overlay.hidden=true;newGame();installGameMethods();tone(440,.08,'triangle',.02);}
  startBtn.addEventListener('click',startBattle);

  function loop(now){
    const dt=Math.min(.033,(now-last)/1000||0);last=now;
    if(!game){newGame();installGameMethods();}
    update(dt);draw();requestAnimationFrame(loop);
  }

  newGame();installGameMethods();requestAnimationFrame(loop);
})();
