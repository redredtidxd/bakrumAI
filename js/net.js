/* ==========================================================================
   8. MULTIJUGADOR (HASTA 6 JUGADORES) VIA MQTT PUBLICO + MUNDO DETERMINISTA
   ==========================================================================
   El juego no tiene servidor propio: se usa un broker MQTT publico (EMQX)
   por WebSockets. Todos los clientes que escriben la MISMA SEMILLA caen en
   la misma sala (el mundo es determinista: misma semilla -> mismo backroom,
   asi que cada uno ve exactamente el mismo laberinto con los demas dentro).

   - Presencia: mensajes RETAINED por jugador; si un cliente se cae sin
     avisar, su presencia se limpia sola con el heartbeat (12 s).
   - Estado: posicion/rotacion/linterna a ~12 Hz, interpolados en remoto.
   - Entidad: SOLO el cliente con el pid mas bajo simula al monstruo y
     publica su posicion; el resto lo ve como espectro sincronizado y sufre
     el contacto/vision igualmente (mundo identico -> muros identicos).
   - Limite: maximo 6 jugadores por sala (mejor esfuerzo, sin servidor).
   ========================================================================== */
    class MultiplayerManager {
        constructor(scene, camera, opts = {}) {
            this.scene = scene;
            this.camera = camera;
            this.onToast = opts.onToast || (() => {});
            this.onKill = opts.onKill || (() => {});
            this.MAX_PLAYERS = 6;

            // Identidad unica de esta sesion (solo [0-9a-zA-Z], requisito MQTT)
            this.pid = 'p' + Math.random().toString(36).slice(2, 8);
            this.roomKey = null;
            this.playerName = 'EXPLORADOR';

            // Brokers publicos probados (WebSocket seguro + MQTT anonimo);
            // si el primero no responde se prueba el siguiente.
            this.brokers = [
                { host: 'broker.hivemq.com', port: 8884, path: '/mqtt' },
                { host: 'broker.emqx.io', port: 8084, path: '/mqtt' }
            ];
            this.brokerIdx = 0;

            this.client = null;
            this.connected = false;   // socket MQTT arriba
            this.joined = false;      // presencia publicada y sala confirmada
            this.snapshotDone = false;
            this.roomFull = false;
            this.isHost = true;       // quien simula la entidad (pid mas bajo)

            this.peers = new Map();   // pid -> { name, lastSeen, x,y,z,yaw, tx,ty,tz,tyaw, f }
            this.remotePlayers = new Map(); // pid -> { group, spot, tgt }
            this.entityGhost = null;
            this.entityTentacles = [];
            this.entityActive = false;
            this.entityLastMsg = 0;
            this.entity = null;       // entidad local (solo la usa el host)

            this.pubTimer = 0;
            this.entPubTimer = 0;
            this.presenceTimer = 0;
            this.cleanTimer = 0;
            this._netHud = '';

            // Objetos recogidos por MI (mensaje RETAINED para la sala)
            this.myClaims = new Set();
            // Puntos de tiza pendientes de enviar (lotes)
            this.chalkQueue = [];
            this.chalkTimer = 0;
            this.onChalkDot = null;   // el juego lo engancha para dibujar puntos remotos
            this.worldSync = null;    // WorldGridSystem (para retirar objetos reclamados)
        }

        // ----------------------------------------------------------------
        //  CONEXION / SALA
        // ----------------------------------------------------------------
        join(roomKey, playerName) {
            this.roomKey = String(roomKey);
            this.playerName = (playerName || 'EXPLORADOR').slice(0, 14).toUpperCase();
            this.isHost = true;

            if (typeof Paho === 'undefined') {
                this.onToast('⚠ MULTIJUGADOR NO DISPONIBLE · modo solitario');
                return;
            }
            this.brokerIdx = 0;
            this.connectNextBroker();
        }

        connectNextBroker() {
            if (this.brokerIdx >= this.brokers.length) {
                this.connected = false;
                this.onToast('⚠ MULTIJUGADOR SIN CONEXIÓN · sigues en solitario');
                return;
            }
            const b = this.brokers[this.brokerIdx++];
            const cid = 'fb' + Math.random().toString(36).slice(2, 10);
            // Paho 1.0.x expone Paho.MQTT.Client; 1.1.x (cdnjs) expone Paho.Client
            const PahoClient = (Paho.MQTT && Paho.MQTT.Client) || Paho.Client;
            try {
                this.client = new PahoClient(b.host, b.port, b.path, cid);
                this.client.onMessageArrived = (m) => this.handleMessage(m);
                this.client.onConnectionLost = (r) => {
                    if (r.errorCode !== 0 && this.joined) {
                        this.connected = false;
                        this.joined = false;
                        this.onToast('⚠ CONEXIÓN DE SALA PERDIDA · sigues en solitario');
                    }
                };
                this.client.connect({
                    useSSL: true,
                    timeout: 8,
                    keepAliveInterval: 20,
                    cleanSession: true,
                    onSuccess: () => this.onConnect(),
                    onFailure: () => this.connectNextBroker()
                });
            } catch (e) {
                this.connectNextBroker();
            }
        }

        onConnect() {
            this.connected = true;
            const sub = (t) => this.client.subscribe(t, { qos: 0 });
            sub(this.presenceTopic('+'));
            sub(this.stateTopic('+'));
            sub(this.entTopic());
            sub(this.claimTopic('+'));
            sub(this.chalkTopic());
            this.publishPresence();
            this.onToast('🛰 CONECTADO · sala ' + this.roomKey);
            // Pequena espera para recibir las presencias retenidas de los que
            // ya estaban, y asi saber cuantos somos antes de entrar de verdad
            setTimeout(() => this.snapshot(), 1300);
        }

        snapshot() {
            if (!this.connected) return;
            const others = [...this.peers.keys()].filter((pid) => pid !== this.pid);
            if (others.length >= this.MAX_PLAYERS) {
                this.roomFull = true;
                this.leave();
                this.onToast('🚫 SALA LLENA (' + this.MAX_PLAYERS + '/' + this.MAX_PLAYERS + ') · prueba otra semilla o juega en solitario');
                return;
            }
            this.snapshotDone = true;
            this.joined = true;
            this.updateHost();
            const total = others.length + 1;
            this.onToast('👥 SALA ' + this.roomKey + ' · ' + total + '/' + this.MAX_PLAYERS + ' EXPLORADORES');
            for (const pid of others) {
                const p = this.peers.get(pid);
                if (p) this.onToast('👤 ' + p.name + ' ya está en la sala');
            }
        }

        // Desconexion limpia: se borra la presencia retenida y se sale
        leave() {
            this.snapshotDone = false;
            this.joined = false;
            this.connected = false;
            if (this.client) {
                try {
                    this.client.send(this.presenceTopic(this.pid), '', 0, true);
                    this.client.send(this.stateTopic(this.pid), '', 0, true);
                } catch (e) { /* noop */ }
                try { this.client.disconnect(); } catch (e) { /* noop */ }
                this.client = null;
            }
            for (const pid of [...this.peers.keys()]) this.removePeerSilent(pid);
            if (this.entityGhost) {
                this.entityGhost.visible = false;
                this.entityActive = false;
            }
        }

        isEntityHost() {
            // Sin sala (solitario o sin conexion) uno es siempre su propio host
            if (!this.connected) return true;
            return this.joined && this.snapshotDone && this.isHost && !this.roomFull;
        }

        updateHost() {
            this.isHost = true;
            for (const pid of this.peers.keys()) {
                if (pid < this.pid) { this.isHost = false; break; }
            }
        }

        // ----------------------------------------------------------------
        //  TOPICOS
        // ----------------------------------------------------------------
        presenceTopic(pid) { return 'br0/' + this.roomKey + '/presence/' + pid; }
        stateTopic(pid) { return 'br0/' + this.roomKey + '/state/' + pid; }
        entTopic() { return 'br0/' + this.roomKey + '/ent'; }
        claimTopic(pid) { return 'br0/' + this.roomKey + '/claims/' + pid; }
        chalkTopic() { return 'br0/' + this.roomKey + '/chalk'; }

        publishPresence() {
            if (!this.client || !this.connected) return;
            try {
                this.client.send(this.presenceTopic(this.pid), JSON.stringify({ n: this.playerName, j: Date.now() }), 0, true);
            } catch (e) { /* noop */ }
        }

        publishState(pos, yaw, pitch, flashlightOn) {
            if (!this.client || !this.connected || !this.joined) return;
            try {
                // Se envia la posicion de los PIES (y = ojos - 1.55) para que el
                // modelo remoto apoye en el suelo; la camara local esta a 1.55 m
                this.client.send(this.stateTopic(this.pid), JSON.stringify({
                    x: pos.x, y: pos.y - 1.55, z: pos.z,
                    yaw: yaw, pitch: pitch,
                    f: flashlightOn ? 1 : 0, t: Date.now()
                }), 0, false);
            } catch (e) { /* noop */ }
        }

        // Reclama un objeto recogido: solo el primero que lo coge se lo queda;
        // el mensaje RETAINED hace que los que entren despues tambien lo vean
        // recogido (cada objeto es de un solo jugador).
        claimPickup(id) {
            if (!this.client || !this.connected || !this.joined) return;
            this.myClaims.add(id);
            try {
                this.client.send(this.claimTopic(this.pid), JSON.stringify([...this.myClaims]), 0, true);
            } catch (e) { /* noop */ }
        }

        // Encola un punto de tiza para compartirlo con la sala (lotes)
        queueChalkDot(point, normal, colorHex) {
            if (!this.client || !this.connected || !this.joined) return;
            if (this.chalkQueue.length >= 60) return;
            const r2 = (v) => Math.round(v * 100) / 100;
            this.chalkQueue.push([r2(point.x), r2(point.y), r2(point.z), r2(normal.x), r2(normal.y), r2(normal.z), colorHex]);
        }

        // ----------------------------------------------------------------
        //  MENSAJES ENTRANTES
        // ----------------------------------------------------------------
        // Dibujos de tiza remotos: cada punto trae posicion, normal y color
        handleChalkMessage(m) {
            let d = {};
            try { d = JSON.parse(m.payloadString); } catch (e) { return; }
            if (!d || d.p === this.pid || !d.dots || !Array.isArray(d.dots) || !this.onChalkDot) return;
            const v = new THREE.Vector3();
            const n = new THREE.Vector3();
            for (const dot of d.dots) {
                if (!Array.isArray(dot) || dot.length < 7) continue;
                v.set(dot[0], dot[1], dot[2]);
                n.set(dot[3], dot[4], dot[5]);
                this.onChalkDot(v, n, dot[6]);
            }
        }
        handleMessage(m) {
            const parts = m.destinationName.split('/');
            const kind = parts[2];

            // Topico de la entidad (br0/sala/ent): sin pid, 3 segmentos
            if (kind === 'ent') {
                this.handleEntityMessage(m);
                return;
            }

            // Dibujos de tiza compartidos (br0/sala/chalk): sin pid, 3 segmentos
            if (kind === 'chalk') {
                this.handleChalkMessage(m);
                return;
            }

            if (parts.length < 4) return;
            const pid = parts[3];
            if (pid === this.pid) return;   // eco de mi propia presencia/estado

            // Objetos recogidos por otros (br0/sala/claims/<pid>, RETAINED):
            // cada jugador publica la lista de lo que ha cogido; quien entre
            // despues la recibe al suscribirse y retira esos objetos del mundo
            if (kind === 'claims') {
                let data = [];
                try { data = JSON.parse(m.payloadString); } catch (e) { return; }
                if (!Array.isArray(data)) return;
                for (const id of data) {
                    if (typeof id !== 'string') continue;
                    if (this.worldSync) this.worldSync.markPickupCollected(id);
                }
                return;
            }

            if (kind === 'presence') {
                if (m.payloadBytes.length === 0) { this.removePeer(pid); return; }
                let data = {};
                try { data = JSON.parse(m.payloadString); } catch (e) { return; }
                if (!data.n) return;
                const isNew = !this.peers.has(pid);
                if (isNew) {
                    // hasState=false: el modelo NO se crea aqui (apareceria en
                    // el origen y volaria por el mapa); se crea al llegar su
                    // primer estado, ya en su posicion real
                    this.peers.set(pid, {
                        name: String(data.n),
                        lastSeen: Date.now(),
                        x: 0, y: 0, z: 0, yaw: 0,
                        tx: 0, ty: 0, tz: 0, tyaw: 0,
                        f: false,
                        hasState: false
                    });
                    if (this.snapshotDone && this.joined && !this.roomFull) {
                        this.onToast('👤 ' + this.peers.get(pid).name + ' entró en la sala');
                        this.updateHost();
                    }
                } else {
                    const p = this.peers.get(pid);
                    p.lastSeen = Date.now();
                    p.name = String(data.n);
                }
                return;
            }

            if (kind === 'state') {
                const p = this.peers.get(pid);
                if (!p) return;
                let d = {};
                try { d = JSON.parse(m.payloadString); } catch (e) { return; }
                // Altura recibida: las versiones nuevas envian los PIES (y≈0);
                // las antiguas enviaban la camara (y≈1.55). Normalizar ambas y
                // anclar al suelo (mundo plano, sin saltos ni desniveles)
                let fy = d.y;
                if (fy == null) fy = 0;
                else if (fy > 1.0) fy -= 1.55;   // convencion antigua: ojos -> pies
                fy = Math.max(0, Math.min(fy, 0.1));
                p.tx = d.x || 0;
                p.ty = fy;
                p.tz = d.z || 0;
                p.tyaw = d.yaw || 0;
                p.f = !!d.f;
                p.lastSeen = Date.now();
                if (!p.hasState) {
                    // Primer estado: crear el modelo YA en su posicion real
                    // (sin aparecer en el origen ni volar hasta aqui)
                    p.hasState = true;
                    if (!this.remotePlayers.has(pid)) this.addRemotePlayer(pid, p);
                    p.x = p.tx;
                    p.y = p.ty;
                    p.z = p.tz;
                    p.yaw = p.tyaw;
                }
                return;
            }
        }

        // Topico de la entidad (br0/sala/ent): el host publica su posicion y
        // cualquiera puede pedir un aturdimiento con el flash de la camara
        handleEntityMessage(m) {
            let d = {};
            try { d = JSON.parse(m.payloadString); } catch (e) { return; }

            // Aturdimiento remoto: el flash de la camara de CUALQUIER jugador
            // aturde a la entidad para todos (el host lo aplica a su simulacion
            // y el resto lo ve congelarse)
            if (d.s && this.entity && this.entity.active && this.isHost) {
                const ox = d.x || 0, oz = d.z || 0;
                const ex = this.entity.pos.x - ox;
                const ez = this.entity.pos.z - oz;
                const dist = Math.hypot(ex, ez);
                if (dist > 0.01 && dist < 24) {
                    const dot = (ex * (d.dx || 0) + ez * (d.dz || 0)) / dist;
                    if (dot > 0.45) this.entity.stun(4.0);
                }
            }

            // El anfitrion ya renderiza su entidad local: no duplicar
            if (this.isHost) return;

            if (d.gone) {
                if (this.entityGhost) this.entityGhost.visible = false;
                this.entityActive = false;
                return;
            }
            if (!this.entityGhost) this.buildEntityGhost();
            this.entityActive = !!d.a;
            if (this.entityGhost) this.entityGhost.visible = this.entityActive;
            if (this.entityActive && this.entityGhost) {
                this.entityGhost.position.set(d.x || 0, 0, d.z || 0);
                this.entityGhost.rotation.y = d.yaw || 0;
                this.entityLastMsg = Date.now();
            }
            if (d.spawned) audio.playMonsterRoar();
        }

        // ----------------------------------------------------------------
        //  JUGADORES REMOTOS (render)
        // ----------------------------------------------------------------
        addRemotePlayer(pid, p) {
            const palette = [0xff6b6b, 0x6bc9ff, 0x8aff6b, 0xffd93b, 0xc77dff, 0xff9a3d];
            let h = 0;
            for (let i = 0; i < pid.length; i++) h = (h * 31 + pid.charCodeAt(i)) >>> 0;
            const col = palette[h % palette.length];

            // Explorador humanoido completo (js/explorer.js), con el torso del
            // color del jugador para distinguirlos en la sala
            const model = createExplorerModel(col);
            const group = model.group;
            const headY = model.headY;

            // Etiqueta con el nombre sobre la cabeza
            const sprite = this.makeNameSprite(p.name);
            sprite.position.y = headY + 0.44;
            group.add(sprite);

            // Linterna del otro jugador: un foco suave para ver hacia donde mira
            const spot = new THREE.SpotLight(0xfff0b0, 1.7, 16, Math.PI / 6, 0.95, 2);
            spot.position.set(0, headY - 0.05, 0.15);
            group.add(spot);
            const tgt = new THREE.Object3D();
            this.scene.add(tgt);
            spot.target = tgt;

            group.visible = false;
            this.scene.add(group);
            this.remotePlayers.set(pid, { group, spot, tgt });
        }

        makeNameSprite(name) {
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 64;
            const ctx = canvas.getContext('2d');
            ctx.font = 'bold 34px Courier New';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
            ctx.fillRect(8, 8, 240, 48);
            ctx.fillStyle = '#ffe9a0';
            ctx.fillText(name, 128, 34);
            const tex = new THREE.CanvasTexture(canvas);
            tex.anisotropy = Math.min(4, this.scene.__r128maxAniso || 4);
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true }));
            sprite.scale.set(1.3, 0.33, 1);
            return sprite;
        }

        removePeer(pid) {
            const p = this.peers.get(pid);
            if (p) this.onToast('👤 ' + p.name + ' abandonó la sala');
            // Si el cliente se cayo sin avisar, se limpia tambien su presencia
            // retenida en el broker (mensaje vacio con retain)
            if (this.client && this.connected) {
                try { this.client.send(this.presenceTopic(pid), '', 0, true); } catch (e) { /* noop */ }
            }
            this.removePeerSilent(pid);
        }

        removePeerSilent(pid) {
            const r = this.remotePlayers.get(pid);
            if (r) {
                this.scene.remove(r.group);
                this.scene.remove(r.tgt);
                this.remotePlayers.delete(pid);
            }
            this.peers.delete(pid);
            this.updateHost();
        }

        // ----------------------------------------------------------------
        //  ESPECTRO DE LA ENTIDAD (para los que no son host)
        // ----------------------------------------------------------------
        buildEntityGhost() {
            const model = createEntityModel();
            model.group.visible = false;
            this.scene.add(model.group);
            this.entityGhost = model.group;
            this.entityTentacles = model.tentacles;
        }

        onEntitySpawned() {
            if (!this.client || !this.connected || !this.joined) return;
            try {
                this.client.send(this.entTopic(), JSON.stringify({
                    a: 1, spawned: 1,
                    x: this.entity.pos.x, z: this.entity.pos.z, yaw: this.entity.yaw
                }), 0, false);
            } catch (e) { /* noop */ }
        }

        requestStun(originPos, dir) {
            if (!this.client || !this.connected || !this.joined || !this.entity) return;
            try {
                this.client.send(this.entTopic(), JSON.stringify({
                    s: 1,
                    x: originPos.x, y: originPos.y, z: originPos.z,
                    dx: dir.x, dy: dir.y, dz: dir.z
                }), 0, false);
            } catch (e) { /* noop */ }
        }

        // La entidad sincronizada esta cerca del jugador (para drenar cordura)
        entityNear(playerPos, range) {
            if (!this.entityActive || !this.entityGhost) return false;
            if (Date.now() - this.entityLastMsg > 3000) return false;
            const g = this.entityGhost.position;
            return Math.hypot(g.x - playerPos.x, g.z - playerPos.z) < range;
        }

        // Linea de vision 2D para el contacto con el espectro (mismos muros
        // en todos los clientes: el mundo es deterministico)
        hasLOS(x0, z0, x1, z1, wallBoxes) {
            const dx = x1 - x0;
            const dz = z1 - z0;
            for (let box of wallBoxes) {
                let tmin = 0, tmax = 1;
                if (Math.abs(dx) < 0.0001) {
                    if (x0 < box.minX || x0 > box.maxX) continue;
                } else {
                    let t1 = (box.minX - x0) / dx;
                    let t2 = (box.maxX - x0) / dx;
                    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
                    tmin = Math.max(tmin, t1);
                    tmax = Math.min(tmax, t2);
                    if (tmin > tmax) continue;
                }
                if (Math.abs(dz) < 0.0001) {
                    if (z0 < box.minZ || z0 > box.maxZ) continue;
                } else {
                    let t1 = (box.minZ - z0) / dz;
                    let t2 = (box.maxZ - z0) / dz;
                    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
                    tmin = Math.max(tmin, t1);
                    tmax = Math.min(tmax, t2);
                    if (tmin > tmax) continue;
                }
                return false;
            }
            return true;
        }

        // ----------------------------------------------------------------
        //  BUCLE POR FRAME
        // ----------------------------------------------------------------
        update(dt, playerPos, yaw, pitch, flashlightOn, wallBoxes, entity) {
            this.entity = entity;

            if (this.connected && this.joined && !this.roomFull) {
                // Estado propio ~12 Hz
                this.pubTimer += dt;
                if (this.pubTimer > 0.083) {
                    this.pubTimer = 0;
                    this.publishState(playerPos, yaw, pitch, flashlightOn);
                }
                // Posicion de la entidad (solo el host la simula y publica)
                this.entPubTimer += dt;
                if (this.isHost && entity && entity.active && this.entPubTimer > 0.1) {
                    this.entPubTimer = 0;
                    try {
                        this.client.send(this.entTopic(), JSON.stringify({
                            a: 1, x: entity.pos.x, z: entity.pos.z, yaw: entity.yaw
                        }), 0, false);
                    } catch (e) { /* noop */ }
                }
                // Refrescar presencia cada 6 s (broker con TTL de retenidos)
                this.presenceTimer += dt;
                if (this.presenceTimer > 6) {
                    this.presenceTimer = 0;
                    this.publishPresence();
                }
                // Dibujos de tiza compartidos: lotes pequenos (~10 msgs/s)
                this.chalkTimer += dt;
                if (this.chalkTimer > 0.1 && this.chalkQueue.length) {
                    this.chalkTimer = 0;
                    const batch = this.chalkQueue.splice(0, 30);
                    try {
                        this.client.send(this.chalkTopic(), JSON.stringify({ p: this.pid, dots: batch }), 0, false);
                    } catch (e) { /* noop */ }
                }
                // Limpieza: jugadores caidos y entidad muda
                this.cleanTimer += dt;
                if (this.cleanTimer > 3) {
                    this.cleanTimer = 0;
                    const now = Date.now();
                    // Timeout generoso (25 s) para que un micro-corte del broker
                    // publico no haga desaparecer a los companeros
                    for (const [pid, p] of [...this.peers]) {
                        if (now - p.lastSeen > 25000) this.removePeer(pid);
                    }
                    if (this.entityActive && now - this.entityLastMsg > 3000) {
                        this.entityActive = false;
                        if (this.entityGhost) this.entityGhost.visible = false;
                    }
                }
            }

            // Interpolacion y render de los jugadores remotos
            const k = 1 - Math.pow(0.0005, dt);
            for (const [pid, p] of this.peers) {
                const r = this.remotePlayers.get(pid);
                if (!r) continue;
                // Salto legitimo (reconexion, reinicio): no interpolar a traves
                // de todo el mapa, teletransportar directo a la posicion real
                if (Math.abs(p.tx - p.x) + Math.abs(p.tz - p.z) > 10) {
                    p.x = p.tx;
                    p.y = p.ty;
                    p.z = p.tz;
                    p.yaw = p.tyaw;
                }
                p.x += (p.tx - p.x) * k;
                p.y += (p.ty - p.y) * k;
                p.z += (p.tz - p.z) * k;
                p.yaw = lerpAngleShort(p.yaw, p.tyaw, k);
                // Red de seguridad: el modelo remoto SIEMPRE con los pies en el
                // suelo (ninguna version vieja de otro jugador puede hacerlo
                // volar con la cabeza en el techo)
                if (p.y < 0 || p.y > 0.1) p.y = Math.max(0, Math.min(0.1, p.y));
                // p.y es la altura de los pies: el modelo se ancla al suelo
                r.group.position.set(p.x, p.y, p.z);
                r.group.rotation.y = p.yaw;
                const dist = this.camera.position.distanceTo(r.group.position);
                r.group.visible = dist < 110;
                if (r.group.visible) {
                    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
                    r.tgt.position.set(p.x + fx * 3, p.y + 1.2, p.z + fz * 3);
                    r.spot.visible = p.f;
                }
            }

            // Espectro de la entidad: animacion suave de tentaculos
            if (this.entityGhost && this.entityGhost.visible) {
                const t = Date.now() * 0.02;
                for (let i = 0; i < this.entityTentacles.length; i++) {
                    this.entityTentacles[i].rotation.x = Math.sin(t + i) * 0.18;
                }
                // Contacto directo con el espectro = muerte (igual que el host)
                const g = this.entityGhost.position;
                if (Math.hypot(g.x - playerPos.x, g.z - playerPos.z) < 0.85 &&
                    this.hasLOS(g.x, g.z, playerPos.x, playerPos.z, wallBoxes)) {
                    audio.playJumpscare();
                    this.onKill('LA ENTIDAD TE ALCANZÓ Y TE DEVORÓ EN LA PENUMBRA');
                }
            }
        }

        // Texto para el HUD: sala, ocupacion y rol
        hudText() {
            if (!this.connected && !this.joined) {
                return this.roomKey ? ('SALA ' + this.roomKey + ' · SOLO (SIN CONEXIÓN)') : 'MULTIJUGADOR: SOLO';
            }
            if (this.roomFull) return 'SALA LLENA (' + this.MAX_PLAYERS + '/' + this.MAX_PLAYERS + ') · SOLO';
            const count = this.peers.size + 1;
            return 'SALA ' + this.roomKey + ' · ' + count + '/' + this.MAX_PLAYERS +
                (this.isHost ? ' · ANFITRIÓN' : '');
        }
    }

    // Interpolacion angular por el camino mas corto
    function lerpAngleShort(a, b, t) {
        let d = (b - a) % (Math.PI * 2);
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
        return a + d * t;
    }