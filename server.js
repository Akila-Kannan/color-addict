const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 3000);
const rooms = new Map();
const sockets = new Set();

function frame(data, opcode = 1) {
  const body = Buffer.from(data);
  let head;
  if (body.length < 126) { head = Buffer.from([0x80 | opcode, body.length]); }
  else if (body.length < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | opcode; head[1] = 126; head.writeUInt16BE(body.length, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | opcode; head[1] = 127; head.writeBigUInt64BE(BigInt(body.length), 2); }
  return Buffer.concat([head, body]);
}
function send(peer, data) { if (!peer.dead) peer.socket.write(frame(JSON.stringify(data))); }
function broadcast(room, data) { for (const p of room.players.values()) send(p, data); }
function snapshot(room) {
  return { type: 'state', room: room.code, phase: room.phase, round: room.round, total: room.total, suddenDeath: !!room.suddenDeath,
    card: room.card, prompt: room.prompt, players: [...room.players.values()].map(p => ({ id:p.id, name:p.name, score:p.score, host:p.id===room.hostId, locked:p.locked })),
    winner: room.winner, lastResult: room.lastResult, readyAt: room.readyAt };
}
function publish(room) { broadcast(room, snapshot(room)); }
const COLORS = [
  {name:'RED', hex:'#fa5266'}, {name:'BLUE', hex:'#5b7cfa'}, {name:'GREEN', hex:'#46c98b'},
  {name:'YELLOW', hex:'#f4bf4f'}, {name:'PURPLE', hex:'#b781f5'}, {name:'ORANGE', hex:'#ff9257'}
];
function nextCard(room) {
  const word = COLORS[Math.floor(Math.random()*COLORS.length)];
  let ink = COLORS[Math.floor(Math.random()*COLORS.length)];
  while (ink.name === word.name) ink = COLORS[Math.floor(Math.random()*COLORS.length)];
  room.card = {word:word.name, ink:ink.name, inkHex:ink.hex};
  room.prompt = Math.random() < .5 ? 'WORD' : 'INK';
  room.round++;
  room.phase = 'playing'; room.lastResult = null;
  for (const p of room.players.values()) p.locked = false;
  publish(room);
  room.timer = setTimeout(() => {
    if (room.phase !== 'playing') return;
    if (room.suddenDeath) { room.phase='finished'; const high=Math.max(...[...room.players.values()].map(p=>p.score)); room.winner=[...room.players.values()].filter(p=>p.score===high).map(p=>p.name); publish(room); return; }
    if (room.round < room.total) { nextCard(room); return; }
    const high=Math.max(...[...room.players.values()].map(p=>p.score));
    const leaders=[...room.players.values()].filter(p=>p.score===high);
    if (leaders.length>1) { room.suddenDeath=true; room.tiedIds=leaders.map(p=>p.id); room.round=room.total; nextCard(room); }
    else { room.phase='finished'; room.winner=leaders.map(p=>p.name); publish(room); }
  }, 7000);
}
function sendError(peer, message) { send(peer, {type:'error', message}); }
function removePeer(peer) {
  if (peer.dead) return;
  peer.dead = true; sockets.delete(peer);
  const room = rooms.get(peer.room);
  if (!room) return;
  room.players.delete(peer.id);
  if (!room.players.size) { clearTimeout(room.timer); rooms.delete(room.code); return; }
  if (room.hostId === peer.id) room.hostId = room.players.keys().next().value;
  publish(room);
}
function handle(peer, msg) {
    if (msg.type === 'join') {
    if (peer.room) return sendError(peer, 'You are already in a room.');
    const code = String(msg.code || '').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5);
    const name = String(msg.name || 'Player').trim().slice(0,18) || 'Player';
    let room = rooms.get(code);
    if (msg.create) {
      let newCode;
      do { newCode = Array.from({length:5},()=> 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random()*32)]).join(''); } while (rooms.has(newCode));
      room = {code:newCode, players:new Map(), hostId:null, phase:'lobby', round:0, total:10, card:null, prompt:null, winner:null, lastResult:null, timer:null, readyAt:null};
      rooms.set(newCode, room);
    } else if (!room) return sendError(peer, 'Room not found. Check the code and try again.');
    if (room.players.size >= 8) return sendError(peer, 'This room is full (8 players max).');
    if (room.phase !== 'lobby' && !msg.create) return sendError(peer, 'This game has already started.');
    peer.id = crypto.randomUUID(); peer.name = name; peer.score = 0; peer.locked = false; peer.room = room.code;
    room.players.set(peer.id, peer);
    if (!room.hostId) room.hostId = peer.id;
    send(peer, {type:'joined', id:peer.id, room:room.code}); publish(room);
  } else if (msg.type === 'start') {
    const room = rooms.get(peer.room); if (!room || room.hostId !== peer.id) return;
    if (room.players.size < 2) return sendError(peer, 'Invite at least one more player to start.');
    room.total = Math.max(5, Math.min(20, Number(msg.total) || 10)); room.round=0;
    for (const p of room.players.values()) { p.score=0; p.locked=false; }
    room.suddenDeath=false; room.phase='ready'; room.readyAt=Date.now()+1800; publish(room);
    clearTimeout(room.timer); room.timer=setTimeout(()=>nextCard(room),1800);
  } else if (msg.type === 'answer') {
    const room = rooms.get(peer.room); if (!room || room.phase !== 'playing' || peer.locked || !room.card) return;
    if (room.suddenDeath && !room.tiedIds?.includes(peer.id)) return;
    const correct = String(msg.color).toUpperCase() === (room.prompt === 'WORD' ? room.card.word : room.card.ink);
    if (!correct) { peer.locked=true; send(peer,{type:'feedback', ok:false, text:'Not that one — take a breath!'}); publish(room); return; }
    peer.locked=true;
    if (room.suddenDeath) {
      peer.score += 1; room.phase='finished'; room.winner=[peer.name]; room.lastResult={name:peer.name,bonus:false};
      publish(room); return;
    }
    peer.score += 1;
    const fastest = [...room.players.values()].every(p => p.locked);
    const correctCount = [...room.players.values()].filter(p=>p.locked && p.score > 0).length;
    // The first correct answer on each card receives the speed bonus.
    const already = room.card.scored;
    if (!already) { peer.score += 1; room.card.scored=true; }
    room.lastResult = {name:peer.name, bonus:!already};
    send(peer,{type:'feedback',ok:true,text:already ? '+1 point' : '+2 points · fastest!'});
    publish(room);
    clearTimeout(room.timer);
    room.timer=setTimeout(()=>{
      if (room.round >= room.total) {
        const high=Math.max(...[...room.players.values()].map(p=>p.score));
        const leaders=[...room.players.values()].filter(p=>p.score===high);
        if (leaders.length>1 && !room.suddenDeath) { room.suddenDeath=true; room.tiedIds=leaders.map(p=>p.id); room.round=room.total; nextCard(room); }
        else { room.phase='finished'; room.winner=leaders.map(p=>p.name); publish(room); }
      } else nextCard(room);
    }, 1450);
  }
}
const server = http.createServer((req,res) => {
  const pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const file = pathname === '/' ? 'index.html' : pathname.replace(/^\//,'');
  const target = path.resolve(ROOT,file);
  if (!target.startsWith(ROOT + path.sep) && target !== path.join(ROOT,'index.html')) { res.writeHead(403).end(); return; }
  fs.readFile(target,(err,data)=>{
    if (err) { res.writeHead(404).end('Not found'); return; }
    const ext=path.extname(target); const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
    res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','Cache-Control':'no-cache'}); res.end(data);
  });
});
server.on('upgrade',(req,socket)=>{
  const key=req.headers['sec-websocket-key']; if(!key) return socket.destroy();
  const accept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  const peer={socket,buffer:Buffer.alloc(0),dead:false}; sockets.add(peer);
  socket.on('data',chunk=>{
    peer.buffer=Buffer.concat([peer.buffer,chunk]);
    while(peer.buffer.length>=2){
      const b0=peer.buffer[0], b1=peer.buffer[1]; let len=b1&127, offset=2;
      if(len===126){if(peer.buffer.length<4)break;len=peer.buffer.readUInt16BE(2);offset=4;}
      else if(len===127){if(peer.buffer.length<10)break;len=Number(peer.buffer.readBigUInt64BE(2));offset=10;}
      const masked=!!(b1&128); if(masked)offset+=4; if(peer.buffer.length<offset+len)break;
      let payload=peer.buffer.subarray(offset,offset+len); if(masked){const mask=peer.buffer.subarray(offset-4,offset);payload=Buffer.from(payload);for(let i=0;i<payload.length;i++)payload[i]^=mask[i%4];}
      peer.buffer=peer.buffer.subarray(offset+len);
      const opcode=b0&15; if(opcode===8){socket.end(frame('',8));removePeer(peer);return;} if(opcode===9){socket.write(frame(payload,10));continue;}
      if(opcode===1){try{handle(peer,JSON.parse(payload.toString()));}catch{sendError(peer,'That message could not be read.');}}
    }
  });
  socket.on('close',()=>removePeer(peer)); socket.on('error',()=>removePeer(peer));
});
server.listen(PORT,'0.0.0.0',()=>console.log(`Color Addict is ready at http://localhost:${PORT}`));
