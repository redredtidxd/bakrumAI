/* ==========================================================================
   8. MULTIJUGADOR (HASTA 6 JUGADORES) VIA MQTT PUBLICO + MUNDO DETERMINISTA
   ==========================================================================
   El juego no tiene servidor propio: se usa un broker MQTT publico (EMQX)
   por WebSockets. Todos los clientes que escriben la MISMA SEMILLA caen en
   la misma sala (el mundo es determinista: misma semilla -> mismo backroom,
   asi que cada uno ve exactamente el mismo laberinto con los demas dentro).

   - Presencia: mensajes RETAINED por jugador; si un cliente se cae sin
     avisar, su presencia se limpia sola con el heartbeat (12 s).
   - Estado: posicion/rotacion/linterna a ~18 Hz (solo con movimiento),
     interpolados en remoto entre muestras con retraso fijo (~120 ms).
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
            this.onRoomListings = opts.onRoomListings || (() => {});
            this.MAX_PLAYERS = 6;
            // Etiqueta de version (p. ej. "v1.13.1 Opt"): se publica en la
            // presencia y en el listado de salas para que cada sala diga que
            // version esta jugando cada explorador.
            this.versionLabel = opts.versionLabel || 'v?';

            // Identidad unica de esta sesion (solo [0-9a-zA-Z], requisito MQTT)
            this.pid = 'p' + Math.random().toString(36).slice(2, 8);
            this.roomKey = null;
            this.playerName = 'EXPLORADOR';
            this.roomVisibility = 'public';
            this.roomName = '';
            this.roomSeed = '';

            // Brokers publicos probados (WebSocket seguro + MQTT anonimo);
            // se intentan TODOS EN PARALELO y gana el primero que conecte
            // (antes eran secuenciales: 2 x 8 s de timeout y el juego podia
            // quedarse "sin conexion" hasta 16 s).
            this.brokers = [
                { host: 'broker.hivemq.com', port: 8884, path: '/mqtt' },
                { host: 'broker.emqx.io', port: 8084, path: '/mqtt' }
            ];
            this._connectingBrokers = false;
            this.directoryBrokerIdx = 0;
            this.directoryClient = null;
            this.directoryConnected = false;
            this.directoryFailed = false;
            this.directoryConnecting = false;
            this.roomDirectory = new Map(); // roomKey -> Map<pid, anuncio publico>
            this._directoryAdvertised = false;
            this._directoryTimer = 0;

            this.client = null;
            this.connected = false;   // socket MQTT arriba
            this.connectionFailed = false; // todos los brokers fallaron
            this.joined = false;      // presencia publicada y sala confirmada
            this.snapshotDone = false;
            this.roomFull = false;
            this.isHost = true;       // quien simula la entidad (pid mas bajo)

            // PING PROPIO real: eco por MQTT (publico en mi topico de ping y
            // mido el RTT al broker). Va en el estado y en la tabla de
            // jugadores; tambien adapta la interpolacion de los demas.
            this.myRtt = undefined;
            this.pingTimer = 0;
            this._pingInFlight = 0;

            this.peers = new Map();   // pid -> { name, lastSeen, x,y,z,yaw, tx,ty,tz,tyaw, f }
            this.remotePlayers = new Map(); // pid -> { group, spot, tgt }
            this.entityGhost = null;
            this.entityTentacles = [];
            this.entityActive = false;
            this.entityLastMsg = 0;
            // Destino interpolado del espectro: el host publica a ~10 Hz y el
            // resto lo movia a saltos ("el monstruo se ve a trompicones");
            // ahora se interpola suavemente hacia la ultima posicion recibida.
            this.entityTgt = null;
            this.fpsSource = null;   // () => fps local; game.js lo engancha
            this.entity = null;       // entidad local (solo la usa el host)
            // Modo de bajo coste (variante Opt): la visibilidad del fantasma
            // X-RAY no se recalcula cada frame, se espacia.
            this.lowFreqMode = !!opts.lowFreqMode;
            this._ghostTick = 0;

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

            // Mapa compartido: cada jugador publica los chunks que ha
            // explorado (bitsets de celdas); los demas los fusionan y todos
            // ven el mismo mapa desbloqueado. mapChunksRef lo engancha el
            // juego (Map "gx,gz" -> Uint8Array(32) con 256 bits de celdas).
            this.mapChunksRef = null;
            this.onMapData = null;    // (listaDeChunks) => void, enganchado por el juego
            this.lastMapPub = 0;
            this.mapTimer = 0;

            // Puertas de metal de las salas de seguridad: el estado abierto/
            // cerrado se comparte con la sala (la pila es de cada jugador)
            this.onDoorData = null;   // ({id, o}) => void

            // MUEBLES GLOBALES: si alguien empuja una mesa/silla o abre un
            // cajon, la sala entera lo ve. Las posiciones se publican en
            // lotes a baja frecuencia; los cajones al momento.
            this.onFurnitureData = null;   // (lista) => void
            this.furnTimer = 0;
            this._furnPub = new Map();     // fid -> {x, z, d} ultimo publicado

            // CHAT DE SALA: mensajes de texto entre exploradores (MQTT)
            this.onChatData = null;        // (nombre, texto) => void

            // Ultimo estado publicado (para mantener la presencia en segundo
            // plano si la pestana se minimiza) y reconexion automatica
            this._lastState = null;
            this._bgTimer = null;
            this._reconnecting = false;
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) this.startBackgroundKeepAlive();
                else this.stopBackgroundKeepAlive();
            });
        }

        // Si la pestana se minimiza, el bucle de frames (rAF) se pausa y se
        // dejaba de publicar presencia/estado: a los ~25 s los demas te daban
        // por salido de la sala aunque siguieras dentro (y tu modelo
        // desaparecia para ellos). Un interval de reserva sigue publicando
        // mientras la pestana este oculta.
        startBackgroundKeepAlive() {
            if (this._bgTimer) return;
            this._bgTimer = setInterval(() => {
                if (!this.connected || !this.joined) return;
                try { this.publishPresence(); } catch (e) { /* noop */ }
                const s = this._lastState;
                if (!s) return;
                try {
                    this.client.send(this.stateTopic(this.pid), JSON.stringify({
                        x: s.x, y: s.y - 1.55, z: s.z,
                        yaw: s.yaw, pitch: s.pitch,
                        f: s.flashlightOn ? 1 : 0, t: Date.now()
                    }), 0, false);
                } catch (e) { /* noop */ }
            }, 2500);
        }

        stopBackgroundKeepAlive() {
            if (this._bgTimer) {
                clearInterval(this._bgTimer);
                this._bgTimer = null;
            }
        }

        // Reconexion automatica si el broker suelta el socket (pestana en
        // segundo plano mucho tiempo, micro-corte, etc.)
        scheduleReconnect() {
            if (this._reconnecting) return;
            this._reconnecting = true;
            setTimeout(() => {
                this._reconnecting = false;
                if (!this.connected && this.roomKey) {
                    try { if (this.client) this.client.disconnect(); } catch (e) { /* noop */ }
                    this.client = null;
                    this.connectionFailed = false;
                    this.connectNextBroker();
                }
            }, 2500);
        }

        // ----------------------------------------------------------------
        //  DIRECTORIO DE SALAS PUBLICAS
        // ----------------------------------------------------------------
        // No hay servidor propio: cada jugador publica un anuncio RETAINED
        // muy pequeño en un canal de directorio. Los anuncios privados nunca
        // se publican, y los viejos caducan localmente tras un corte.
        directoryWildcard() { return 'br0/directory/#'; }
        directoryTopic(roomKey, pid) { return 'br0/directory/' + roomKey + '/' + pid; }

        purgeRoomDirectory() {
            const now = Date.now();
            for (const [roomKey, members] of [...this.roomDirectory]) {
                for (const [pid, data] of [...members]) {
                    if (!data || now - (data.t || 0) > 18000) members.delete(pid);
                }
                if (!members.size) this.roomDirectory.delete(roomKey);
            }
        }

        emitRoomListings() {
            this.purgeRoomDirectory();
            const out = [];
            for (const [key, members] of this.roomDirectory) {
                const list = [...members.values()];
                if (!list.length) continue;
                const first = list[0];
                const names = [...new Set(list.map(x => String(x.n || 'EXPLORADOR')).filter(Boolean))];
                out.push({
                    key,
                    seed: first.seed == null ? key.replace(/^pub_/, '') : first.seed,
                    name: first.roomName || ('SALA ' + (first.seed == null ? key : first.seed)),
                    count: list.length,
                    names,
                    max: this.MAX_PLAYERS,
                    visibility: 'public',
                    version: first.ver || 'v?'
                });
            }
            out.sort((a, b) => (b.count || 0) - (a.count || 0));
            this.onRoomListings(out);
            return out;
        }

        handleDirectoryMessage(m) {
            const parts = m.destinationName.split('/');
            const roomKey = parts[2], pid = parts[3];
            if (!roomKey || !pid) return;
            let members = this.roomDirectory.get(roomKey);
            if (m.payloadBytes.length === 0 || !m.payloadString) {
                if (members) {
                    members.delete(pid);
                    if (!members.size) this.roomDirectory.delete(roomKey);
                }
                this.emitRoomListings();
                return;
            }
            let data = {};
            try { data = JSON.parse(m.payloadString); } catch (e) { return; }
            if (data.v !== 'public' || !data.n) return;
            if (!members) {
                members = new Map();
                this.roomDirectory.set(roomKey, members);
            }
            data.t = typeof data.t === 'number' ? data.t : Date.now();
            members.set(pid, data);
            this.emitRoomListings();
        }

        requestRoomListings() {
            this.emitRoomListings();
            if (typeof Paho === 'undefined') return;
            if (this.connected && this.client) {
                try { this.client.subscribe(this.directoryWildcard(), { qos: 0 }); } catch (e) { /* noop */ }
                return;
            }
            if (this.directoryConnected && this.directoryClient) return;
            if (this.directoryConnecting) return;
            // Reintentar si el intento anterior fallo
            if (this.directoryFailed) this.directoryBrokerIdx = 0;
            this.directoryFailed = false;
            this.connectDirectoryNext();
        }

        connectDirectoryNext() {
            if (this.directoryConnected || this.directoryConnecting) return;
            this.directoryConnecting = true;
            this.directoryFailed = false;
            if (this.directoryBrokerIdx >= this.brokers.length) {
                this.directoryConnecting = false;
                this.directoryFailed = true;
                return;
            }
            const b = this.brokers[this.directoryBrokerIdx++];
            const cid = 'fbd' + Math.random().toString(36).slice(2, 10);
            const PahoClient = (Paho.MQTT && Paho.MQTT.Client) || Paho.Client;
            try {
                const client = new PahoClient(b.host, b.port, b.path, cid);
                client.onMessageArrived = (m) => this.handleMessage(m);
                client.onConnectionLost = () => {
                    if (this.directoryClient === client) {
                        this.directoryConnected = false;
                        this.directoryClient = null;
                    }
                };
                client.connect({
                    useSSL: true,
                    timeout: 5,
                    keepAliveInterval: 20,
                    cleanSession: true,
                    onSuccess: () => {
                        this.directoryClient = client;
                        this.directoryConnected = true;
                        this.directoryConnecting = false;
                        this.directoryFailed = false;
                        try { client.subscribe(this.directoryWildcard(), { qos: 0 }); } catch (e) { /* noop */ }
                        this.emitRoomListings();
                    },
                    onFailure: () => {
                        this.directoryConnecting = false;
                        this.connectDirectoryNext();
                    }
                });
            } catch (e) {
                this.directoryConnecting = false;
                this.connectDirectoryNext();
            }
        }

        stopDirectoryOnly() {
            if (this.directoryClient) {
                try { this.directoryClient.disconnect(); } catch (e) { /* noop */ }
            }
            this.directoryClient = null;
            this.directoryConnected = false;
        }

        publishDirectoryPresence() {
            if (this.roomVisibility !== 'public' || !this.client || !this.connected || !this.joined || !this.roomKey) return;
            try {
                this.client.send(this.directoryTopic(this.roomKey, this.pid), JSON.stringify({
                    v: 'public', p: this.pid, n: this.playerName,
                    seed: this.roomSeed, roomName: this.roomName,
                    ver: this.versionLabel, t: Date.now()
                }), 0, true);
                this._directoryAdvertised = true;
            } catch (e) { /* noop */ }
        }

        clearDirectoryPresence() {
            if (!this._directoryAdvertised || !this.roomKey) return;
            try {
                if (this.client && this.connected) this.client.send(this.directoryTopic(this.roomKey, this.pid), '', 0, true);
            } catch (e) { /* noop */ }
            this._directoryAdvertised = false;
            const members = this.roomDirectory.get(this.roomKey);
            if (members) {
                members.delete(this.pid);
                if (!members.size) this.roomDirectory.delete(this.roomKey);
            }
            this.emitRoomListings();
        }

        // ----------------------------------------------------------------
        //  CONEXION / SALA
        // ----------------------------------------------------------------
        join(roomKey, playerName, roomOpts = {}) {
            this.stopDirectoryOnly();
            this.roomKey = String(roomKey);
            this.playerName = (playerName || 'EXPLORADOR').slice(0, 14).toUpperCase();
            this.roomVisibility = roomOpts.visibility === 'private' ? 'private' : 'public';
            this.roomName = String(roomOpts.roomName || ('SALA ' + this.roomKey)).slice(0, 28);
            this.roomSeed = roomOpts.seed == null ? this.roomKey : roomOpts.seed;
            this._directoryAdvertised = false;
            this.isHost = true;
            // Nueva sala -> nueva medida de ping (otro canal/broker)
            this.myRtt = undefined;
            this._pingInFlight = 0;

            // PID PERSISTENTE por sala+nombre: al recargar o reiniciar la
            // pagina se reutiliza la misma identidad (mismo topico RETAINED),
            // asi la presencia anterior se SOBRESCRIBE en vez de convivir con
            // la nueva ("al reiniciar se ven jugadores duplicados"). Si el
            // jugador cambia de nombre o de sala, se genera otro pid.
            try {
                const pidKey = 'fb_pid:' + this.roomKey + ':' + this.playerName;
                let saved = localStorage.getItem(pidKey);
                if (!saved || !/^p[a-z0-9]{5}$/.test(saved)) {
                    saved = 'p' + Math.random().toString(36).slice(2, 8);
                    localStorage.setItem(pidKey, saved);
                }
                this.pid = saved;
            } catch (e) { /* localStorage puede fallar (modo privado): pid nuevo */ }

            if (typeof Paho === 'undefined') {
                this.onToast('⚠ MULTIJUGADOR NO DISPONIBLE · modo solitario');
                return;
            }
            this.connectionFailed = false;
            this.connectNextBroker();
        }

        // Conexion a la sala: se lanzan TODOS los brokers en paralelo y gana
        // el primero que conecte (los perdedores se desconectan solos). Con
        // timeout 5 s, el peor caso baja de ~16 s a ~5 s, y lo normal es
        // entrar en 1-2 s.
        connectNextBroker() {
            if (this._connectingBrokers) return;
            this._connectingBrokers = true;
            this.connectionFailed = false;
            this.connected = false;
            const PahoClient = (Paho.MQTT && Paho.MQTT.Client) || Paho.Client;
            const attempts = [];
            for (let i = 0; i < this.brokers.length; i++) {
                const b = this.brokers[i];
                let client = null;
                try {
                    client = new PahoClient(b.host, b.port, b.path, 'fb' + Math.random().toString(36).slice(2, 10));
                } catch (e) { /* broker inutilizable */ }
                if (!client) continue;
                const attempt = { client, done: false };
                attempts.push(attempt);
                client.onMessageArrived = (m) => this.handleMessage(m);
                client.onConnectionLost = (r) => {
                    // Solo reacciona el cliente que estaba en uso
                    if (this.client !== client) return;
                    if (r.errorCode !== 0 && this.joined) {
                        this.connected = false;
                        this.joined = false;
                        this.onToast('⚠ CONEXIÓN DE SALA PERDIDA · reconectando…');
                        this.scheduleReconnect();
                    }
                };
                const finish = (ok) => {
                    if (attempt.done) return;
                    attempt.done = true;
                    if (ok && !this.connected) {
                        this.connected = true;
                        this.client = client;
                        // Desconectar a los perdedores
                        for (const a of attempts) {
                            if (a !== attempt && !a.done) {
                                a.done = true;
                                try { a.client.disconnect(); } catch (e) { /* noop */ }
                            }
                        }
                        this._connectingBrokers = false;
                        this.onConnect();
                    } else if (!ok && attempts.every(a => a.done)) {
                        this._connectingBrokers = false;
                        this.connectionFailed = true;
                        this.connected = false;
                        this.onToast('⚠ MULTIJUGADOR SIN CONEXIÓN · sigues en solitario');
                    }
                };
                try {
                    client.connect({
                        useSSL: true,
                        timeout: 5,
                        keepAliveInterval: 20,
                        cleanSession: true,
                        onSuccess: () => finish(true),
                        onFailure: () => finish(false)
                    });
                } catch (e) {
                    finish(false);
                }
            }
            if (!attempts.length) {
                this._connectingBrokers = false;
                this.connectionFailed = true;
                this.onToast('⚠ MULTIJUGADOR SIN CONEXIÓN · sigues en solitario');
            }
        }

        onConnect() {
            this.connected = true;
            const sub = (t) => this.client.subscribe(t, { qos: 0 });
            sub(this.presenceTopic('+'));
            sub(this.stateTopic('+'));
            sub(this.pingTopic('+'));
            sub(this.entTopic());
            sub(this.claimTopic('+'));
            sub(this.chalkTopic());
            sub(this.mapTopic());
            sub(this.doorTopic());
            sub(this.furnitureTopic());
            sub(this.chatTopic());
            try { sub(this.directoryWildcard()); } catch (e) { /* algunos brokers limitan comodines */ }
            this.publishPresence();
            this.onToast('🛰 CONECTADO · sala ' + this.roomKey);
            // Pequena espera para recibir las presencias retenidas de los que
            // ya estaban, y asi saber cuantos somos antes de entrar de verdad
            setTimeout(() => this.snapshot(), 900);
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
            // La sala se entera por el chat de que este explorador ha entrado
            this.publishChat('ha entrado en la sala');
            this.updateHost();
            this.publishDirectoryPresence();
            this.emitRoomListings();
            // Nada mas entrar se comparte el mapa explorado hasta ahora: el
            // mapa es GLOBAL, lo que cualquier jugador ha visto lo ve la sala
            this.publishMap();
            const total = others.length + 1;
            this.onToast('👥 SALA ' + this.roomKey + ' · ' + total + '/' + this.MAX_PLAYERS + ' EXPLORADORES');
            for (const pid of others) {
                const p = this.peers.get(pid);
                if (p) this.onToast('👤 ' + p.name + ' ya está en la sala');
            }
        }

        // Desconexion limpia: se borra la presencia retenida y se sale
        leave() {
            // La sala se entera por el chat de que este explorador se va
            if (this.joined && this.connected) {
                try { this.publishChat('ha salido de la sala'); } catch (e) { /* noop */ }
            }
            this.clearDirectoryPresence();
            this.snapshotDone = false;
            this.joined = false;
            this.connected = false;
            this.stopBackgroundKeepAlive();
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
        pingTopic(pid) { return 'br0/' + this.roomKey + '/ping/' + pid; }
        entTopic() { return 'br0/' + this.roomKey + '/ent'; }
        claimTopic(pid) { return 'br0/' + this.roomKey + '/claims/' + pid; }
        chalkTopic() { return 'br0/' + this.roomKey + '/chalk'; }
        mapTopic() { return 'br0/' + this.roomKey + '/map'; }
        doorTopic() { return 'br0/' + this.roomKey + '/doors'; }
        furnitureTopic() { return 'br0/' + this.roomKey + '/furn'; }
        chatTopic() { return 'br0/' + this.roomKey + '/chat'; }

        publishPresence() {
            if (!this.client || !this.connected) return;
            try {
                this.client.send(this.presenceTopic(this.pid), JSON.stringify({ n: this.playerName, j: Date.now(), v: this.versionLabel }), 0, true);
            } catch (e) { /* noop */ }
        }

        publishState(pos, yaw, pitch, flashlightOn) {
            if (!this.client || !this.connected || !this.joined) return;
            try {
                // Se envia la posicion de los PIES (y = ojos - 1.55) para que el
                // modelo remoto apoye en el suelo; la camara local esta a 1.55 m
                // El fps local viaja con el estado: la tabla de jugadores
                // muestra el rendimiento de cada explorador. Tambien viaja el
                // RTT propio medido por eco: cada jugador informa de su ping
                // REAL al broker (la tabla y la interpolacion lo usan).
                this.client.send(this.stateTopic(this.pid), JSON.stringify({
                    x: pos.x, y: pos.y - 1.55, z: pos.z,
                    yaw: yaw, pitch: pitch,
                    f: flashlightOn ? 1 : 0, t: Date.now(),
                    fps: this.fpsSource ? Math.round(this.fpsSource()) : 0,
                    r: typeof this.myRtt === 'number' ? Math.round(this.myRtt) : 0
                }), 0, false);
            } catch (e) { /* noop */ }
        }

        // Mide el PING PROPIO de verdad: publica un eco en SU topico de ping
        // (el broker lo devuelve a quien este suscrito, tambien a si mismo) y
        // cronometra la vuelta. Antes la tabla mostraba un guion para el
        // jugador local y los demas veian la estimacion por relojes (que con
        // relojes desviados o subida movil marcaba 850-999 ms falsos).
        publishPingEcho() {
            if (!this.client || !this.connected || !this.joined) return;
            // Si el eco anterior se perdio, se deja pasar tras 3 s
            if (this._pingInFlight && Date.now() - this._pingInFlight > 3000) this._pingInFlight = 0;
            if (Date.now() - this._pingInFlight < 1200) return;
            this._pingInFlight = Date.now();
            try {
                this.client.send(this.pingTopic(this.pid), JSON.stringify({ p: this.pid, t: Date.now() }), 0, false);
            } catch (e) { /* noop */ }
        }

        handlePingMessage(m) {
            let d = {};
            try { d = JSON.parse(m.payloadString); } catch (e) { return; }
            if (!d || !d.t) return;
            if (d.p === this.pid) {
                // Eco de MI propio ping
                const rtt = Date.now() - d.t;
                if (rtt > 0 && rtt < 60000) {
                    this.myRtt = this.myRtt === undefined ? rtt : this.myRtt * 0.7 + rtt * 0.3;
                }
                this._pingInFlight = 0;
            } else {
                // Ping de OTRO jugador: se ignora (su estado ya trae su rtt)
            }
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

        // Estado de una puerta de metal (sala de seguridad): abierta o cerrada
        publishDoor(id, open) {
            if (!this.client || !this.connected || !this.joined) return;
            try {
                this.client.send(this.doorTopic(), JSON.stringify({ id, o: open ? 1 : 0 }), 0, false);
            } catch (e) { /* noop */ }
        }

        // Un cajon de mesa se abrio: toda la sala lo ve (y el objeto que
        // esconda, si lo habia, aparece para todos; quien lo coja lo reclama)
        publishDrawer(fid) {
            if (!this.client || !this.connected || !this.joined || !fid) return;
            try {
                this.client.send(this.furnitureTopic(), JSON.stringify({ f: [{ id: fid, d: 1 }] }), 0, false);
            } catch (e) { /* noop */ }
        }

        // Muebles movidos (empujados) y cajones abiertos: lotes a ~1 Hz para
        // que la sala vea las mesas/sillas en su sitio real sin saturar el
        // broker. Se saltan los muebles que acaban de recibir una posicion
        // remota (evita el ping-pong entre clientes).
        publishFurniture(furnitureBodies) {
            if (!this.client || !this.connected || !this.joined || !furnitureBodies) return;
            const out = [];
            const now = Date.now();
            for (const b of furnitureBodies) {
                if (!b || !b.fid) continue;
                if (b._remoteAt && now - b._remoteAt < 1800) continue;
                if (Math.hypot(b.mesh.position.x - this.camera.position.x, b.mesh.position.z - this.camera.position.z) > 55) continue;
                const prev = this._furnPub.get(b.fid);
                const drawerOpen = (b.mesh.userData && b.mesh.userData.drawer && b.mesh.userData.drawer.open) ? 1 : 0;
                const x = Math.round(b.mesh.position.x * 100) / 100;
                const z = Math.round(b.mesh.position.z * 100) / 100;
                if (!prev || Math.abs(prev.x - x) > 0.06 || Math.abs(prev.z - z) > 0.06 || (prev.d || 0) !== drawerOpen) {
                    out.push({ id: b.fid, x, z, d: drawerOpen });
                    this._furnPub.set(b.fid, { x, z, d: drawerOpen });
                    if (out.length >= 40) break;
                }
            }
            if (!out.length) return;
            try {
                this.client.send(this.furnitureTopic(), JSON.stringify({ f: out }), 0, false);
            } catch (e) { /* noop */ }
        }

        // Mensaje de chat de sala
        publishChat(text) {
            if (!this.client || !this.connected || !this.joined) return;
            try {
                this.client.send(this.chatTopic(), JSON.stringify({ p: this.pid, n: this.playerName, m: text }), 0, false);
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
        // Chunks explorados por OTRO jugador: { p, c: [[gx, gz, bitsHex], ...] }
        handleMapMessage(m) {
            let d = {};
            try { d = JSON.parse(m.payloadString); } catch (e) { return; }
            if (!d || d.p === this.pid || !Array.isArray(d.c) || !this.onMapData) return;
            this.onMapData(d.c);
        }

        // Publica el mapa explorado (throttled: max 1 mensaje cada 2,5 s y
        // snapshots periodicos para quien entre tarde). Cada chunk se envia
        // como 64 digitos hex (256 celdas = 32 bytes), con un tope de ~24 KB
        // por mensaje: el mapa crece despacio, asi que cabe entero.
        publishMap() {
            if (!this.client || !this.connected || !this.joined || !this.mapChunksRef) return;
            const now = Date.now();
            if (now - this.lastMapPub < 2500) return;
            this.lastMapPub = now;
            const out = [];
            let size = 0;
            for (const [key, bits] of this.mapChunksRef) {
                const [gx, gz] = key.split(',');
                let hex = '';
                for (let i = 0; i < 32; i += 2) {
                    hex += ((bits[i] << 8) | bits[i + 1]).toString(16).padStart(4, '0');
                }
                out.push([+gx, +gz, hex]);
                size += hex.length + 12;
                if (size > 24000) break;
            }
            if (!out.length) return;
            try {
                this.client.send(this.mapTopic(), JSON.stringify({ p: this.pid, c: out }), 0, false);
            } catch (e) { /* noop */ }
        }

        handleMessage(m) {
            const parts = m.destinationName.split('/');
            const kind = parts[2];

            // Topico de la entidad (br0/sala/ent): sin pid, 3 segmentos
            if (parts[1] === 'directory') {
                this.handleDirectoryMessage(m);
                return;
            }

            if (kind === 'ent') {
                this.handleEntityMessage(m);
                return;
            }

            // Eco de ping (br0/sala/ping/<pid>): mide el RTT real al broker
            if (kind === 'ping') {
                this.handlePingMessage(m);
                return;
            }

            // Dibujos de tiza compartidos (br0/sala/chalk): sin pid, 3 segmentos
            if (kind === 'chalk') {
                this.handleChalkMessage(m);
                return;
            }

            // Mapa compartido (br0/sala/map): chunks explorados por cada uno
            if (kind === 'map') {
                this.handleMapMessage(m);
                return;
            }

            // Puertas de las salas de seguridad (br0/sala/doors): quien abre o
            // cierra una puerta lo ve toda la sala
            if (kind === 'doors') {
                let d = {};
                try { d = JSON.parse(m.payloadString); } catch (e) { return; }
                if (d && d.id && this.onDoorData) this.onDoorData(d);
                return;
            }

            // Muebles globales (br0/sala/furn): posiciones empujadas y
            // cajones abiertos por otros jugadores
            if (kind === 'furn') {
                let d = {};
                try { d = JSON.parse(m.payloadString); } catch (e) { return; }
                if (d && Array.isArray(d.f) && this.onFurnitureData) this.onFurnitureData(d.f);
                return;
            }

            // Chat de sala (br0/sala/chat): mensajes de texto entre jugadores
            if (kind === 'chat') {
                let d = {};
                try { d = JSON.parse(m.payloadString); } catch (e) { return; }
                if (d && d.p !== this.pid && d.m && this.onChatData) {
                    this.onChatData(String(d.n || '?'), String(d.m).slice(0, 200));
                }
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
                // DUPLICADO DE MI MISMA SESION: si cierras la pestana y
                // vuelves, el broker conserva la presencia RETAINED de tu
                // sesion anterior (y si esa pestana sigue viva en segundo
                // plano, hasta su estado): aparecias como OTRO jugador con tu
                // mismo nombre ("veo una duplica mia"). Se limpia aqui y en
                // el temporizador de mantenimiento, sin avisar.
                if (pid !== this.pid && data.n === this.playerName) {
                    try { this.client.send(this.presenceTopic(pid), '', 0, true); } catch (e) { /* noop */ }
                    this.removePeerSilent(pid);
                    return;
                }
                const isNew = !this.peers.has(pid);
                if (isNew) {
                    // hasState=false: el modelo NO se crea aqui (apareceria en
                    // el origen y volaria por el mapa); se crea al llegar su
                    // primer estado, ya en su posicion real
                    this.peers.set(pid, {
                        name: String(data.n),
                        version: data.v || 'v?',
                        lastSeen: Date.now(),
                        x: 0, y: 0, z: 0, yaw: 0,
                        tx: 0, ty: 0, tz: 0, tyaw: 0,
                        f: false,
                        hasState: false,
                        hist: [],
                        timeBase: undefined,
                        ping: undefined,
                        rtt: undefined
                    });
                    if (this.snapshotDone && this.joined && !this.roomFull) {
                        this.onToast('👤 ' + this.peers.get(pid).name + ' entró en la sala');
                        // Versiones distintas en la misma sala: se avisa (cada
                        // uno puede ver cosas distintas, pero se juega junto)
                        if (data.v && data.v !== this.versionLabel) {
                            this.onToast('🔄 ' + this.peers.get(pid).name + ' juega ' + data.v + ' (tú: ' + this.versionLabel + ') · el mundo puede variar');
                        }
                        this.updateHost();
                    }
                } else {
                    const p = this.peers.get(pid);
                    p.lastSeen = Date.now();
                    p.name = String(data.n);
                    if (data.v) p.version = data.v;
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
                p.fps = (typeof d.fps === 'number' && d.fps > 0) ? d.fps : p.fps;
                // RTT REAL informado por el propio jugador (medido por eco en
                // su maquina): la tabla y la interpolacion lo prefieren a la
                // estimacion por relojes (que se disparaba a 850-999 ms con
                // relojes desviados o subida movil).
                if (typeof d.r === 'number' && d.r > 0 && d.r < 60000) p.rtt = d.r;
                p.lastSeen = Date.now();
                p.lastStateAt = Date.now();
                // Historial con marcas de tiempo para interpolar con retraso
                // fijo. El reloj del emisor se normaliza al local con la
                // primera muestra (los relojes de cada maquina pueden ir
                // desviados); si el mensaje viejo no trae t, se usa la hora
                // de llegada.
                if (p.timeBase === undefined) {
                    p.timeBase = (typeof d.t === 'number' && isFinite(d.t)) ? Date.now() - d.t : 0;
                }
                // Latencia aproximada por jugador: el emisor marca cada estado
                // con su reloj; timeBase cancela la desviacion entre relojes,
                // asi el resto es el retardo real de red, suavizado.
                if (typeof d.t === 'number' && isFinite(d.t)) {
                    const rtt = Math.max(0, Math.min(999, Date.now() - (d.t + p.timeBase)));
                    p.ping = p.ping === undefined ? rtt : p.ping * 0.8 + rtt * 0.2;
                }
                const tLocal = (typeof d.t === 'number' && isFinite(d.t)) ? d.t + p.timeBase : Date.now();
                p.hist = p.hist || [];
                p.hist.push({ t: tLocal, x: p.tx, y: p.ty, z: p.tz, yaw: p.tyaw });
                if (p.hist.length > 40) p.hist.shift();
                while (p.hist.length > 2 && tLocal - p.hist[0].t > 1500) p.hist.shift();
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
            if (this.entityActive) {
                this.entityTgt = { x: d.x || 0, z: d.z || 0, yaw: d.yaw || 0 };
                if (this.entityGhost) {
                    // Primera muestra: colocar en su sitio; despues, interpolar
                    if (!this.entityGhost.userData._entInit) {
                        this.entityGhost.userData._entInit = true;
                        this.entityGhost.position.set(this.entityTgt.x, 0, this.entityTgt.z);
                        this.entityGhost.rotation.y = this.entityTgt.yaw;
                    }
                }
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

            // Etiqueta con el nombre sobre la cabeza (se anade ANTES de
            // clonar el fantasma para que este tambien lleve el nombre)
            const sprite = this.makeNameSprite(p.name);
            sprite.position.y = headY + 0.44;
            group.add(sprite);

            // FANTASMA X-RAY: clon del modelo con material que ignora la
            // profundidad. Se muestra SOLO cuando un muro o un MUEBLE tapa al
            // jugador (linea de vision bloqueada): asi nunca se pierde de
            // vista a un companero entre las paredes, pero tampoco se le ve
            // "atravesar" mesas o armarios. Lleva su etiqueta de nombre:
            // la silueta sola costaba de identificar.
            const ghost = group.clone();
            ghost.traverse((o) => {
                if (o.isMesh) {
                    o.material = new THREE.MeshBasicMaterial({
                        color: col,
                        transparent: true,
                        opacity: 0.3,
                        depthTest: false,
                        depthWrite: false
                    });
                } else if (o.isSprite) {
                    o.material = o.material.clone();
                    o.material.depthTest = false;
                    o.material.depthWrite = false;
                    o.material.transparent = true;
                    o.material.opacity = 0.6;
                }
            });
            ghost.visible = false;
            this.scene.add(ghost);

            // Linterna del otro jugador: un foco suave para ver hacia donde mira
            const spot = new THREE.SpotLight(0xfff0b0, 1.7, 16, Math.PI / 6, 0.95, 2);
            spot.position.set(0, headY - 0.05, 0.15);
            group.add(spot);
            const tgt = new THREE.Object3D();
            this.scene.add(tgt);
            spot.target = tgt;

            group.visible = false;
            this.scene.add(group);
            this.remotePlayers.set(pid, { group, spot, tgt, sprite, ghost, limbs: model.limbs || null, _phase: 0, _prevX: null, _prevZ: null });
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
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
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
                if (r.ghost) this.scene.remove(r.ghost);
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
            if (!this.client || !this.connected || !this.joined || !this.entity) return;
            try {
                this.client.send(this.entTopic(), JSON.stringify({
                    a: 1, spawned: 1,
                    x: this.entity.pos.x, z: this.entity.pos.z, yaw: this.entity.yaw
                }), 0, false);
            } catch (e) { /* noop */ }
        }

        onEntityGone() {
            if (!this.client || !this.connected || !this.joined) return;
            try {
                this.client.send(this.entTopic(), JSON.stringify({ gone: 1, a: 0 }), 0, false);
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
        // en todos los clientes: el mundo es deterministico). Prefiltro por
        // caja envolvente del segmento: las cajas que no tocan el rectangulo
        // entre origen y destino no pueden tapar la vision y se saltan (el
        // mundo tiene cientos de cajas, el segmento mide pocos metros).
        hasLOS(x0, z0, x1, z1, wallBoxes) {
            const dx = x1 - x0;
            const dz = z1 - z0;
            const minX = Math.min(x0, x1) - 0.01, maxX = Math.max(x0, x1) + 0.01;
            const minZ = Math.min(z0, z1) - 0.01, maxZ = Math.max(z0, z1) + 0.01;
            for (let box of wallBoxes) {
                if (box.maxX < minX || box.minX > maxX || box.maxZ < minZ || box.minZ > maxZ) continue;
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
        update(dt, playerPos, yaw, pitch, flashlightOn, wallBoxes, entity, furnitureBodies) {
            this.entity = entity;
            this._lastState = { x: playerPos.x, y: playerPos.y, z: playerPos.z, yaw, pitch, flashlightOn };
            // Interpolacion suave del espectro hacia la ultima posicion del
            // host (a ~10 Hz): movimiento continuo, sin trompicones.
            if (!this.isHost && this.entityGhost && this.entityActive && this.entityTgt) {
                const g = this.entityGhost;
                const k = Math.min(1, dt * 9);
                g.position.x += (this.entityTgt.x - g.position.x) * k;
                g.position.z += (this.entityTgt.z - g.position.z) * k;
                let dy = this.entityTgt.yaw - g.rotation.y;
                while (dy > Math.PI) dy -= Math.PI * 2;
                while (dy < -Math.PI) dy += Math.PI * 2;
                g.rotation.y += dy * Math.min(1, dt * 8);
            }
            // Cajas ACTUALES de los muebles (no las de su spawn): el fantasma
            // X-RAY se bloquea tambien con el mobiliario movido
            const furnitureBoxes = furnitureBodies ? furnitureBodies.map(b => b.aabb).filter(Boolean) : null;

            if (this.connected && this.joined && !this.roomFull) {
                // Estado propio ~18 Hz pero SOLO cuando hay movimiento real:
                // un jugador quieto no necesita tantos mensajes. Mas
                // frecuencia = los demas te ven mas fluido y con menos delay
                // (el broker publico aguanta este ritmo en salas de 6). Se
                // sigue publicando al menos cada 0,5 s para que el timeout de
                // 45 s de los demas nunca te eche de la sala.
                this.pubTimer += dt;
                if (this.pubTimer > 0.055) {
                    this.pubTimer = 0;
                    const moved = !this._lastPubPos ||
                        Math.hypot(playerPos.x - this._lastPubPos.x, playerPos.z - this._lastPubPos.z) > 0.05 ||
                        Math.abs(yaw - this._lastPubYaw) > 0.02 ||
                        Math.abs(pitch - this._lastPubPitch) > 0.08;
                    // Latido en reposo cada 200 ms (antes 500): un jugador
                    // quieto (p. ej. dibujando con tiza) seguita mandando
                    // posicion, y con conexiones lentas los demas no se
                    // quedan sin datos ni extrapolan a la deriva.
                    const idleBeat = Date.now() - (this._lastPubAt || 0) > 200;
                    if (moved || idleBeat) {
                        this._lastPubPos = playerPos.clone();
                        this._lastPubYaw = yaw;
                        this._lastPubPitch = pitch;
                        this._lastPubAt = Date.now();
                        this.publishState(playerPos, yaw, pitch, flashlightOn);
                    }
                }
                // Eco de ping propio (~cada 3 s) para medir el RTT real
                this.pingTimer += dt;
                if (this.pingTimer > 3) {
                    this.pingTimer = 0;
                    this.publishPingEcho();
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
                this._directoryTimer += dt;
                if (this._directoryTimer > 7) {
            this._directoryTimer = 0;
            this.publishDirectoryPresence();
            // Si el directorio se cayo, se reintenta (el listado de salas
            // publicas debe volver a funcionar solo)
            if (!this.directoryConnected && !this.directoryConnecting && !this.connected) {
                this.directoryBrokerIdx = 0;
                this.connectDirectoryNext();
            }
        }
                // Mapa compartido: snapshot periodico (~5 s) para que quien
                // entre tarde reciba todo lo explorado por la sala
                this.mapTimer += dt;
                if (this.mapTimer > 5) {
                    this.mapTimer = 0;
                    this.publishMap();
                }
                // Muebles globales: lotes a ~1 Hz (posiciones empujadas y
                // cajones abiertos visibles para toda la sala)
                this.furnTimer += dt;
                if (this.furnTimer > 1.0) {
                    this.furnTimer = 0;
                    this.publishFurniture(furnitureBodies);
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
                    // Timeout generoso (45 s) para que un micro-corte del broker
                    // publico o una pestana en segundo plano no hagan
                    // desaparecer a los companeros
                    for (const [pid, p] of [...this.peers]) {
                        // Duplicado de mi sesion anterior (pestana vieja aun
                        // viva en segundo plano publicando estado): se limpia
                        // en silencio y ademas se borra su presencia retenida
                        // para que el resto de la sala tambien la descarte
                        if (p.name === this.playerName) {
                            try { this.client.send(this.presenceTopic(pid), '', 0, true); } catch (e) { /* noop */ }
                            this.removePeerSilent(pid);
                            continue;
                        }
                        if (now - p.lastSeen > 45000) this.removePeer(pid);
                    }
                    if (this.entityActive && now - this.entityLastMsg > 3000) {
                        this.entityActive = false;
                        if (this.entityGhost) this.entityGhost.visible = false;
                    }
                }
            }

            // Interpolacion y render de los jugadores remotos. Se interpola
            // entre dos muestras RECIBIDAS (historial con marcas de tiempo)
            // con un retraso de render ADAPTATIVO: ~120 ms con red buena,
            // mas si el otro jugador o el broker van lentos (con retraso fijo
            // y latencias de 500-900 ms el modelo se congelaba y pegaba
            // tirones: "veo a los jugadores moviendose con tirones").
            const nowMs = Date.now();
            // Retraso de render comun: el peor RTT entre el mio y el del
            // companero marca cuanto hay que esperar para no quedarse sin
            // muestras (unos ~55% del RTT + 70 ms de colchon)
            let maxPeerRtt = 0;
            for (const p of this.peers.values()) {
                if (p.rtt && p.rtt > maxPeerRtt) maxPeerRtt = p.rtt;
            }
            this._maxPeerRtt = maxPeerRtt;
            const renderDelay = Math.max(120, Math.min(450,
                Math.max(this.myRtt || 0, maxPeerRtt) * 0.55 + 70));
            this._ghostTick++;
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
                } else {
                    const hist = p.hist;
                    if (hist && hist.length >= 2) {
                        const target = nowMs - renderDelay;
                        let a = hist[0], b = hist[hist.length - 1];
                        for (let i = 0; i < hist.length - 1; i++) {
                            if (hist[i].t <= target && hist[i + 1].t >= target) { a = hist[i]; b = hist[i + 1]; break; }
                        }
                        let f = (b.t - a.t) > 0.001 ? (target - a.t) / (b.t - a.t) : 1;
                        if (target > b.t) {
                            // Sin datos mas alla de la ultima muestra: si el
                            // ultimo mensaje es viejo (micro-corte del broker
                            // o latencia alta) nos quedamos en la ultima
                            // posicion conocida; si no, extrapolamos un tramo
                            // corto para que el movimiento no se congele.
                            // El umbral se adapta a la latencia real: con
                            // 500-900 ms de ping, 350 ms fijos lo dejaban
                            // congelado casi siempre.
                            const stale = nowMs - (p.lastStateAt || 0) > Math.max(450, (p.rtt || 0) + 300);
                            f = stale ? 1 : Math.min(1 + (target - b.t) / Math.max(0.001, b.t - a.t), 1.3);
                        } else if (target < a.t) {
                            f = 0;
                        }
                        p.x = a.x + (b.x - a.x) * f;
                        p.y = a.y + (b.y - a.y) * f;
                        p.z = a.z + (b.z - a.z) * f;
                        p.yaw = lerpAngleShort(a.yaw, b.yaw, f);
                    }
                }
                // Red de seguridad: el modelo remoto SIEMPRE con los pies en el
                // suelo (ninguna version vieja de otro jugador puede hacerlo
                // volar con la cabeza en el techo)
                if (p.y < 0 || p.y > 0.1) p.y = Math.max(0, Math.min(0.1, p.y));
                // p.y es la altura de los pies: el modelo se ancla al suelo
                r.group.position.set(p.x, p.y, p.z);
                // Animacion de caminar: la velocidad sale de la distancia
                // entre frames (el modelo camina de verdad, no es un maniqui
                // que se desliza). Sin movimiento, vuelve al reposo.
                if (r.limbs) {
                    const dx = p.x - (r._prevX === null ? p.x : r._prevX);
                    const dz = p.z - (r._prevZ === null ? p.z : r._prevZ);
                    const spd = Math.min(1, Math.hypot(dx, dz) / Math.max(0.001, dt * 1.6));
                    if (spd < 0.03) r._phase = 0;
                    else r._phase += Math.hypot(dx, dz) * 4.0;
                    animateExplorerWalk(r, r._phase, spd);
                    r._prevX = p.x;
                    r._prevZ = p.z;
                }
                // El modelo mira hacia +Z local (la linterna y la cara estan
                // en +Z) y el forward del jugador es (-sin, -cos): sin el
                // giro de 180° los demas veian tu ESPALDA (y la linterna
                // apuntaba hacia atras)
                r.group.rotation.y = p.yaw + Math.PI;
                const dist = this.camera.position.distanceTo(r.group.position);
                r.group.visible = dist < 110;
                if (r.group.visible) {
                    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
                    r.tgt.position.set(p.x + fx * 3, p.y + 1.2, p.z + fz * 3);
                    r.spot.visible = p.f;
                    // La etiqueta de nombre se atenua con la distancia (antes
                    // flotaba visible a cientos de metros, como un texto
                    // flotante pegado a la vista)
                    if (r.sprite) {
                        const o = Math.max(0, Math.min(1, 1.15 - dist / 55));
                        r.sprite.material.opacity = o;
                        r.sprite.visible = o > 0.02;
                    }
                    // Fantasma X-RAY: visible solo cuando un muro o un MUEBLE
                    // tapa al jugador (la linea de vision de la camara al
                    // modelo pasa por alguna caja de colision). Los muebles
                    // cuentan: antes la silueta se veia a traves de las mesas
                    // y parecia que el jugador las atravesaba.
                    if (r.ghost) {
                        r.ghost.position.copy(r.group.position);
                        r.ghost.rotation.y = r.group.rotation.y;
                        // En la variante Opt el tanteo de linea de vision no
                        // se repite cada frame (cuesta un barrido de cajas por
                        // jugador remoto): se recalcula 1 de cada 4 frames.
                        if (!this.lowFreqMode || (this._ghostTick & 3) === 0) {
                            let blocked = !this.hasLOS(
                                this.camera.position.x, this.camera.position.z,
                                p.x, p.z, wallBoxes
                            );
                            if (!blocked && furnitureBoxes) {
                                blocked = !this.hasLOS(
                                    this.camera.position.x, this.camera.position.z,
                                    p.x, p.z, furnitureBoxes
                                );
                            }
                            r._ghostBlocked = blocked;
                        }
                        r.ghost.visible = !!r._ghostBlocked;
                    }
                } else if (r.ghost) {
                    r.ghost.visible = false;
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

        getPublicRooms() {
            return this.emitRoomListings();
        }

        // Texto para el HUD: sala, ocupacion y rol. Mientras se intenta
        // conectar se dice CONECTANDO (antes se leia "SIN CONEXIÓN" durante
        // los primeros segundos, aunque la conexion estuviera en marcha).
        hudText() {
            if (!this.connected && !this.joined) {
                if (this.connectionFailed) {
                    return this.roomKey ? ('SALA ' + this.roomKey + ' · SOLO (SIN CONEXIÓN)') : 'MULTIJUGADOR: SOLO';
                }
                return this.roomKey ? ('SALA ' + this.roomKey + ' · CONECTANDO…') : 'MULTIJUGADOR: SOLO';
            }
            if (this.roomFull) return 'SALA LLENA (' + this.MAX_PLAYERS + '/' + this.MAX_PLAYERS + ') · SOLO';
            const count = this.peers.size + 1;
            return 'SALA ' + this.roomKey + ' · ' + count + '/' + this.MAX_PLAYERS +
                (this.isHost ? ' · ANFITRIÓN' : '') + (this.myRtt !== undefined ? ' · ' + Math.round(this.myRtt) + ' ms' : '');
        }
    }

    // Interpolacion angular por el camino mas corto
    function lerpAngleShort(a, b, t) {
        let d = (b - a) % (Math.PI * 2);
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
        return a + d * t;
    }