/* ==========================================================================
       7. CONTROLADOR PRINCIPAL, ILUMINACIÓN Y NIEBLA AMARILLENTA CONTINUA
       ========================================================================== */
    // Dispositivos táctiles: pantalla pequeña o sin puntero fino. La pantalla
    // pequeña tambien cuenta (un móvil en modo escritorio puede reportar
    // pointer:fine y antes se quedaba sin controles táctiles).
    const IS_TOUCH = (('ontouchstart' in window) || navigator.maxTouchPoints > 0) &&
        (window.innerWidth < 1100 || !window.matchMedia('(pointer: fine)').matches);

    // VERSION DEL JUEGO: se muestra en el menú principal y en el HUD.
    // Al subirla, actualiza también el ?v=... de index.html (cache busting:
    // así el navegador no se queda con los js antiguos en caché).
    const GAME_VERSION = '1.11.0';

    class BackroomsGame {
        constructor() {
            this.container = document.getElementById('canvas-container');
            this.clock = new THREE.Clock();

            this.scene = new THREE.Scene();

            // Niebla progresiva: el fondo se desvanece en un degradado amarillo pálido
            // en lugar de un corte brusco o una pared oscura
            const FOG_COLOR = 0x26200e;
            this.scene.background = new THREE.Color(FOG_COLOR);
            this.scene.fog = new THREE.FogExp2(FOG_COLOR, 0.042);

            this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
            this.camera.rotation.order = 'YXZ';

            this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            // En movil se baja la resolucion (pixel ratio 1): mas fps y menos calor
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_TOUCH ? 1 : 1.5));
            this.renderer.setClearColor(FOG_COLOR);
            // Control de exposición: mapeado de tonos oscuro y aterrador
            this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
            this.renderer.toneMappingExposure = 0.62;
            this.container.appendChild(this.renderer.domElement);

            // Anisotropía: paredes y moqueta se ven nítidas incluso en ángulo rasante
            const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
            [Materials.floor.map, Materials.wall.map, Materials.ceiling.map].forEach(t => {
                if (t) t.anisotropy = Math.min(8, maxAniso);
            });

            // Luz ambiental casi nula: paredes y moqueta en penumbra ocre
            // AMARILLENTA (el backroom fluorescente, no blanco). Un punto mas
            // que antes: las zonas entre lamparas dejaban de leerse y el
            // contraste con el pasillo iluminado era demasiado abrupto.
            this.ambientLight = new THREE.AmbientLight(0xded187, 0.14);
            this.scene.add(this.ambientLight);

            // Relleno hemisférico mínimo para evitar el aspecto lavado
            this.hemiLight = new THREE.HemisphereLight(0xfff3c0, 0x6a5d30, 0.13);
            this.scene.add(this.hemiLight);

            this.flashlightOn = true;
            // Linterna mejorada: mas alcance, tono calido amarillento y un cono
            // algo mas cerrado con borde suave (penumbra alta)
            this.flashlight = new THREE.SpotLight(0xfff0b0, 2.2, 40, Math.PI / 6, 0.95, 2.0);
            this.flashlight.position.set(0, 0, 0);
            this.flashlight.target = new THREE.Object3D();
            this.camera.add(this.flashlight.target);
            this.flashlight.target.position.set(0, 0, -1);
            this.camera.add(this.flashlight);

            this.flashLight = new THREE.PointLight(0xffffff, 0, 28, 2.0);
            this.camera.add(this.flashLight);
            this.scene.add(this.camera);

            // Piscina de luces de techo AMARILLENTAS (0xffd878): antes eran 8
            // focos con radio 9 m que no llegaban ni a la lampara vecina y el
            // pasillo quedaba negro hasta pisar cada foco. Ahora 64 focos con
            // radio 18 m: se iluminan siempre las 64 lamparas MAS CERCANAS
            // (ver updateLights), asi una sala grande o un cruce con muchas
            // lamparas queda entero encendido.
            this.lightPool = [];
            for (let i = 0; i < 64; i++) {
                const pl = new THREE.PointLight(0xffd878, 0, 18, 2.0);
                this.scene.add(pl);
                this.lightPool.push(pl);
            }

            this.player = {
                pos: this.camera.position,
                speedWalk: 3.6,
                speedSprint: 5.6,
                radius: 0.35,
                stamina: 100,
                sanity: 100,
                stepTimer: 0,
                bobTimer: 0
            };

            this.inventory = {
                currentSlot: 1,
                hasChalk: false,
                chalkColor: '#ffffff',
                chalkColorName: 'BLANCO',
                chalkPoints: 0,
                hasCamera: false,
                flashCharges: 0,
                almondWaterCount: 0,
                flashBattery: 100,
                batteries: 0,
                notesCollected: 0,
                totalNotes: NOTE_POOL.length
            };

            // Semilla del mundo: aleatoria por defecto (el campo del menu
            // inicial permite fijar una y regenerar el mundo al empezar)
            this.worldSeed = (Math.random() * 0xFFFFFFFF) >>> 0;
            setWorldSeed(this.worldSeed);
            // Codigo de sala compartido: por defecto la semilla numerica;
            // si el jugador escribe una semilla con LETRAS, el codigo es el
            // propio texto (saneado) y asi se comparte tal cual se escribe.
            this.roomCode = null;
            this.updateSeedLabel();

            this.worldSystem = new WorldGridSystem(this.scene);
            this.chalkSystem = new ChalkDrawingSystem(this.scene, this.camera);
            this.entity = new BacteriophageEntity(this.scene, this.worldSystem);

            // Multijugador (hasta 6): mismo mundo deterministico + broker MQTT
            this.net = new MultiplayerManager(this.scene, this.camera, {
                onToast: (msg) => this.notify(msg),
                onKill: (reason) => this.triggerGameOver(reason)
            });
            // El mundo y la tiza se sincronizan por red: objetos reclamados y
            // dibujos visibles para toda la sala
            this.net.worldSync = this.worldSystem;
            this.net.onChalkDot = (pt, n, c) => this.chalkSystem.addDot(pt, n, c);
            // Mapa compartido: publico lo que exploro y fusiono lo de los demas.
            // OJO: mapChunksRef se enlaza DESPUES de crear exploredChunks (si
            // se enlaza antes queda undefined y nadie publica su mapa).
            this.net.onMapData = (chunks) => this.mergeMapData(chunks);
            // Puertas de metal de las salas de seguridad: el estado abierto/
            // cerrado se comparte con la sala (la pila es de cada jugador)
            this.doorStates = new Map();   // id -> abierto?
            this.net.onDoorData = (d) => {
                // Se guarda SIEMPRE (aunque la sala no este cargada: se aplica
                // al cargar el chunk); y si esta cargada, se aplica ya
                this.doorStates.set(d.id, !!d.o);
                const r = this.findSecurityRoomById(d.id);
                if (r && r.state.doorOpen !== !!d.o) {
                    r.state.doorOpen = !!d.o;
                    this.worldSystem.rebuildUnions();
                }
            };
            // Muebles GLOBALES: si un companero empuja una mesa o abre un
            // cajon, se ve en toda la sala (posiciones y cajones)
            this.net.onFurnitureData = (list) => this.applyRemoteFurniture(list);
            // Chat de sala
            this.net.onChatData = (n, m) => this.appendChat(n, m);
            this.chatOpen = false;
            // Feeds de los monitores de las salas de seguridad: UNO POR
            // MONITOR (cada pantalla muestra una camara DISTINTA, con su
            // render target y su barrido lateral). Clave: id de sala + indice.
            this._monFeeds = new Map();
            this._feedTime = 0;
            this._noSignalTex = null;
            this._panelTimer = 0;
            this._iRechargeAcc = 0;
            this._entSpawnNotified = false;

            window.addEventListener('beforeunload', () => this.net.leave());
            window.addEventListener('pagehide', () => this.net.leave());

            // Mapa del backroom: se desbloquea al explorar y se comparte con
            // la sala (bitsets de celdas por chunk, sync por MQTT)
            this.exploredChunks = new Map();   // "gx,gz" -> Uint8Array(32) (256 bits)
            this.net.mapChunksRef = this.exploredChunks;
            this.mapDirty = false;
            this.mapOpen = false;
            this.mapView = { x: 0, z: 0, zoom: 9 };   // centro (mundo) + px por celda
            this._mapTick = 0;
            this._mapPubTick = 0;
            this._mapRedrawTick = 0;

            // Muebles con física: visibles y asentados desde el inicio (cero
            // flotación); se sincronizan tambien al cargar chunks nuevos
            this.furnitureBodies = [];
            this.syncFurnitureBodies();
            window.__game = this; // DEBUG HOOK (temporal)

            this.setupRandomSpawn();

            this.keys = {};
            this.pitch = 0;
            this.isLocked = false;
            this.isMouseDown = false;
            this.gameActive = false;
            this.touchMove = { x: 0, y: 0 };   // joystick tactil (movil)
            this.touchDrawHeld = false;        // boton de dibujar pulsado (movil)

            if (IS_TOUCH) document.body.classList.add('touch-mode');

            this.initInput();
            this.initTouch();
            this.initNoiseCanvas();
            this.initUI();
            const notesLabel = document.getElementById('notes-count-label');
            if (notesLabel) notesLabel.textContent = `NOTAS: 0 / ${this.inventory.totalNotes}`;
            this.updateFlashlightHUD();

            setTimeout(() => {
                // Solo el ANFITRIÓN de la sala (o el jugador solitario) simula
                // la entidad; el resto la ve como espectro sincronizado. El
                // spawn en si lo hace la entidad a los 50 s (y reaparece sola
                // si el jugador se aleja demasiado); al aparecer de verdad se
                // avisa a la sala con onEntitySpawned.
                if (this.gameActive && this.net.isEntityHost()) {
                    this.entity.canRespawn = true;
                }
            }, 50000);

            window.addEventListener('resize', () => this.onResize());
            this.animate();
        }

        toggleFlashlight() {
            // Sin pila no se puede encender: hay que buscar pilas por el nivel
            if (!this.flashlightOn && this.inventory.flashBattery <= 0) {
                if (this.inventory.batteries > 0) {
                    this.inventory.batteries--;
                    this.inventory.flashBattery = 100;
                    this.notify('🔋 PILA COLOCADA · 100%');
                    audio.playSwitchClick();
                } else {
                    this.notify('⚡ SIN PILA · busca pilas por el nivel');
                    return;
                }
            }

            this.flashlightOn = !this.flashlightOn;
            this.flashlight.intensity = this.flashlightOn ? 2.2 : 0;
            if (this.flashlightOn) audio.playSwitchClick();
            this.updateFlashlightHUD();
        }

        notify(msg) {
            const box = document.getElementById('toast-box');
            if (!box) return;
            const el = document.createElement('div');
            el.className = 'toast';
            el.textContent = msg;
            box.appendChild(el);
            while (box.children.length > 3) box.removeChild(box.firstChild);
            setTimeout(() => {
                el.classList.add('out');
                setTimeout(() => el.remove(), 500);
            }, 2400);
        }

        updateFlashlightBattery(dt) {
            // La pila se gasta sólo con la linterna encendida (~2 min de uso)
            if (this.flashlightOn) {
                this.inventory.flashBattery = Math.max(0, this.inventory.flashBattery - dt * 0.8);

                if (this.inventory.flashBattery <= 0) {
                    if (this.inventory.batteries > 0) {
                        this.inventory.batteries--;
                        this.inventory.flashBattery = 100;
                        this.notify('🔋 PILA CAMBIADA AUTOMÁTICAMENTE');
                        audio.playSwitchClick();
                    } else {
                        this.flashlightOn = false;
                        this.flashlight.intensity = 0;
                        this.notify('⚡ LINTERNA SIN PILA');
                    }
                } else if (this.inventory.flashBattery < 20) {
                    // Parpadeo agonizante antes de agotarse
                    this.flashlight.intensity = 1.2 + Math.random() * 1.1;
                    if (Math.random() < 0.06) audio.flickerHum();
                } else {
                    this.flashlight.intensity = 2.2;
                }
            }
            this.updateFlashlightHUD();
        }

        updateFlashlightHUD() {
            const pct = Math.max(0, Math.round(this.inventory.flashBattery));
            // Boton de linterna en movil: atenuado cuando esta apagada
            const fbtn = document.getElementById('btn-touch-flash');
            if (fbtn) fbtn.classList.toggle('off', !this.flashlightOn);
            const statusLabel = document.getElementById('flashlight-status');
            if (statusLabel) {
                statusLabel.textContent = `🔦 LINTERNA: [${this.flashlightOn ? 'ENCENDIDA' : 'APAGADA'}] · PILA ${pct}% (TECLA F)`;
                statusLabel.style.color = this.flashlightOn ? '#e5d8b0' : (pct <= 0 ? '#b3563f' : '#7d7460');
            }
            const fill = document.getElementById('battery-fill');
            const lab = document.getElementById('battery-label');
            if (fill) {
                fill.style.width = `${pct}%`;
                fill.style.background = pct <= 0 ? '#7a2c22' : (pct < 25 ? '#c98d2b' : '#a8c247');
                fill.style.animation = (this.flashlightOn && pct < 25) ? 'blink 0.7s infinite' : 'none';
            }
            if (lab) {
                // El contador de pilas de repuesto vive en el INVENTARIO
                // (ranura PILAS del cinturon), no pegado a la linterna
                lab.textContent = `${pct}%`;
                lab.style.color = pct <= 0 ? '#d15b4a' : '#b7a97c';
            }
            // Inventario de pilas: numero de repuestos (sustituye al de notas)
            const battCount = document.getElementById('batteries-count-label');
            if (battCount) battCount.textContent = String(this.inventory.batteries);
            // Pildora de pila compacta (movil): misma bateria, mini barra
            const fillM = document.getElementById('battery-fill-mobile');
            const labM = document.getElementById('battery-label-mobile');
            if (fillM) {
                fillM.style.width = `${pct}%`;
                fillM.style.background = pct <= 0 ? '#7a2c22' : (pct < 25 ? '#c98d2b' : '#a8c247');
                fillM.style.animation = (this.flashlightOn && pct < 25) ? 'blink 0.7s infinite' : 'none';
            }
            if (labM) {
                labM.textContent = `${pct}%`;
                labM.style.color = pct <= 0 ? '#d15b4a' : '#b7a97c';
            }
        }

        setupRandomSpawn() {
            // Mundo infinito: aparecemos cerca del origen, donde los recursos
            // de arranque estan garantizados
            const cells = this.worldSystem.walkableCells;
            const near = cells.filter(c => Math.max(Math.abs(c.x), Math.abs(c.z)) < CHUNK_SIZE * 3);
            const pool = near.length >= 20 ? near : cells;
            // Determinista: misma semilla -> SIEMPRE el mismo punto de aparicion
            // (antes Math.random: cada partida empezaba en un sitio distinto y
            // con la misma semilla parecia un backroom diferente)
            const rng = mulberry32((this.worldSeed ^ 0x9E3779B9) >>> 0);
            const spawnCell = pool[Math.floor(rng() * pool.length)];
            const spawnX = (spawnCell.x + 0.5) * CELL_SIZE;
            const spawnZ = (spawnCell.z + 0.5) * CELL_SIZE;

            this.player.pos.set(spawnX, 1.55, spawnZ);

            const dirs = [
                { dx: 0, dz: -1, yaw: 0.0 },
                { dx: -1, dz: 0, yaw: Math.PI / 2 },
                { dx: 0, dz: 1, yaw: Math.PI },
                { dx: 1, dz: 0, yaw: -Math.PI / 2 }
            ];

            let maxSight = -1;
            let bestYaw = 0.0;

            for (let d of dirs) {
                let sight = 0;
                let cx = spawnCell.x;
                let cz = spawnCell.z;
                while (true) {
                    cx += d.dx;
                    cz += d.dz;
                    const t = this.worldSystem.cellTypeAt(cx, cz);
                    if (t === 0 || t === 2) {
                        sight++;
                    } else break;
                }
                if (sight > maxSight) {
                    maxSight = sight;
                    bestYaw = d.yaw;
                }
            }

            this.yaw = bestYaw;
            this.camera.rotation.set(0, this.yaw, 0, 'YXZ');
        }

        initInput() {
            document.addEventListener('keydown', (e) => {
                this.keys[e.code] = true;
                if (!this.gameActive) return;

                if (e.code === 'KeyF') this.toggleFlashlight();
                if (e.code === 'Digit1') this.selectSlot(1);
                if (e.code === 'Digit2') this.selectSlot(2);
                if (e.code === 'Digit3') this.selectSlot(3);
                if (e.code === 'KeyE') this.handleInteraction();
                if (e.code === 'KeyN') this.toggleNotebook();
                if (e.code === 'KeyM') this.toggleMap();
                if (e.code === 'KeyT' && !this.chatOpen) this.toggleChat(true);
                if (e.code === 'Escape' && this.chatOpen) this.toggleChat(false);
            });

            document.addEventListener('keyup', (e) => {
                this.keys[e.code] = false;
            });

            document.addEventListener('mousemove', (e) => {
                if (!this.isLocked) return;
                const sens = 0.002;
                this.yaw -= e.movementX * sens;
                this.pitch -= e.movementY * sens;
                this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch));

                this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
            });

            document.addEventListener('mousedown', (e) => {
                if (!this.isLocked || !this.gameActive) return;
                if (e.button === 0) {
                    this.isMouseDown = true;
                    if (this.inventory.currentSlot === 2) {
                        this.triggerCameraFlash();
                    }
                }
            });

            document.addEventListener('mouseup', (e) => {
                if (e.button === 0) {
                    this.isMouseDown = false;
                    this.chalkSystem.lastDrawPoint = null;
                }
            });

            this.renderer.domElement.addEventListener('click', () => {
                // En movil no hay pointer lock: los controles tactiles ya estan activos
                if (this.gameActive && !this.isLocked && !IS_TOUCH) {
                    document.body.requestPointerLock();
                }
            });

            document.addEventListener('pointerlockchange', () => {
                this.isLocked = document.pointerLockElement === document.body;
            });
        }

        // ---- CONTROLES TACTILES (móvil/tableta) ----
        // Mitad izquierda: joystick virtual dinamico (moverse). Resto de la
        // pantalla: arrastrar para mirar; un toque rapido dispara la camara
        // (slot 2) o interactua. Botones en pantalla: correr, dibujar,
        // linterna, cuaderno e interactuar.
        initTouch() {
            if (!IS_TOUCH) return;
            const joyBase = document.getElementById('joy-base');
            const joyKnob = document.getElementById('joy-knob');
            const LEFT_ZONE = 0.42;
            let joyId = null, joyOx = 0, joyOy = 0;
            let lookId = null, lookX = 0, lookY = 0, lookT = 0, lookSX = 0, lookSY = 0;

            document.addEventListener('touchstart', (e) => {
                if (!this.gameActive) return;
                // IMPORTANTE: solo se hace preventDefault cuando el toque se
                // CONSUME para joystick/mirar. Si el dedo cae sobre un boton
                // o el cuaderno/mapa abiertos, NO se cancela nada: asi los
                // clicks de los botones (CERRAR cuaderno, mapa...) funcionan
                // en movil y el cuaderno puede hacer scroll.
                let consumed = false;
                for (const t of e.changedTouches) {
                    const el = document.elementFromPoint(t.clientX, t.clientY);
                    if (el && el.closest('button, .tool-slot, input, textarea, #notebook-modal, #map-modal, #chat-ui')) continue;
                    if (joyId === null && t.clientX < window.innerWidth * LEFT_ZONE) {
                        joyId = t.identifier;
                        joyOx = t.clientX; joyOy = t.clientY;
                        joyBase.style.display = 'block';
                        joyBase.style.left = (t.clientX - 55) + 'px';
                        joyBase.style.top = (t.clientY - 55) + 'px';
                        joyKnob.style.transform = 'translate(-50%, -50%)';
                        this.touchMove.x = 0; this.touchMove.y = 0;
                        consumed = true;
                    } else if (lookId === null) {
                        lookId = t.identifier;
                        lookX = t.clientX; lookY = t.clientY;
                        lookSX = t.clientX; lookSY = t.clientY;
                        lookT = performance.now();
                        if (this.touchDrawHeld && this.inventory.currentSlot === 1) {
                            this.isMouseDown = true;   // dibujar con la tiza
                        }
                        consumed = true;
                    }
                }
                if (consumed) e.preventDefault();
            }, { passive: false });

            document.addEventListener('touchmove', (e) => {
                if (!this.gameActive) return;
                let consumed = false;
                for (const t of e.changedTouches) {
                    if (t.identifier === joyId) {
                        let dx = t.clientX - joyOx, dy = t.clientY - joyOy;
                        const len = Math.hypot(dx, dy);
                        const max = 56;
                        if (len > 1) {
                            const cl = Math.min(1, len / max);
                            dx = dx / len * max * cl;
                            dy = dy / len * max * cl;
                        }
                        this.touchMove.x = dx / max;
                        this.touchMove.y = -dy / max;   // arriba en pantalla = hacia delante
                        joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
                        consumed = true;
                    } else if (t.identifier === lookId) {
                        if (this.touchDrawHeld && this.inventory.currentSlot === 1) {
                            this.isMouseDown = true;    // dibujando: el dedo pinta en el centro de la pantalla
                            consumed = true;
                            continue;
                        }
                        const dx = t.clientX - lookX, dy = t.clientY - lookY;
                        lookX = t.clientX; lookY = t.clientY;
                        const sens = 0.004 * (600 / Math.max(window.innerWidth, window.innerHeight));
                        this.yaw -= dx * sens;
                        this.pitch -= dy * sens;
                        this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch));
                        this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
                        consumed = true;
                    }
                }
                if (consumed) e.preventDefault();
            }, { passive: false });

            const endTouch = (e) => {
                if (!this.gameActive) return;
                let consumed = false;
                for (const t of e.changedTouches) {
                    if (t.identifier === joyId) {
                        joyId = null;
                        joyBase.style.display = 'none';
                        this.touchMove.x = 0; this.touchMove.y = 0;
                        consumed = true;
                    } else if (t.identifier === lookId) {
                        lookId = null;
                        this.isMouseDown = false;
                        this.chalkSystem.lastDrawPoint = null;
                        const dur = performance.now() - lookT;
                        const dist = Math.hypot(t.clientX - lookSX, t.clientY - lookSY);
                        if (dur < 260 && dist < 14) {
                            // Toque rapido: disparo de camara (slot 2) o interactuar
                            if (this.inventory.currentSlot === 2) this.triggerCameraFlash();
                            else this.handleInteraction();
                            consumed = true;
                        }
                    }
                }
                if (consumed) e.preventDefault();
            };
            document.addEventListener('touchend', endTouch, { passive: false });
            document.addEventListener('touchcancel', endTouch, { passive: false });

            // Botones: mantener pulsado para correr/dibujar, toque para el resto
            const bindHold = (id, on, off) => {
                const el = document.getElementById(id);
                if (!el) return;
                el.addEventListener('touchstart', (e) => { e.preventDefault(); if (this.gameActive) on(); });
                el.addEventListener('touchend', (e) => { e.preventDefault(); off(); });
                el.addEventListener('touchcancel', () => off());
            };
            bindHold('btn-touch-run', () => { this.keys['ShiftLeft'] = true; }, () => { this.keys['ShiftLeft'] = false; });
            bindHold('btn-touch-draw', () => { this.touchDrawHeld = true; }, () => {
                this.touchDrawHeld = false;
                this.isMouseDown = false;
                this.chalkSystem.lastDrawPoint = null;
            });
            const bindTap = (id, fn) => {
                const el = document.getElementById(id);
                if (!el) return;
                el.addEventListener('touchstart', (e) => { e.preventDefault(); if (this.gameActive) fn(); });
            };
            bindTap('btn-touch-flash', () => this.toggleFlashlight());
            bindTap('btn-touch-note', () => this.toggleNotebook());
            bindTap('btn-touch-chat', () => this.toggleChat());
            bindTap('btn-touch-map', () => this.toggleMap());
            bindTap('btn-touch-interact', () => this.handleInteraction());
            // Cerrar cuaderno/mapa tambien por toque directo (el click sintetico
            // puede quedar bloqueado en algunos navegadores moviles)
            bindTap('btn-close-notebook', () => this.toggleNotebook());
            bindTap('btn-close-notebook-x', () => this.toggleNotebook());
            bindTap('btn-close-map', () => this.toggleMap());
            bindTap('btn-map-zoom-in', () => this.mapZoom(1.35));
            bindTap('btn-map-zoom-out', () => this.mapZoom(1 / 1.35));
            bindTap('btn-map-center', () => this.mapCenterOnPlayer());
        }

        initNoiseCanvas() {
            this.noiseCanvas = document.getElementById('noise-canvas');
            this.noiseCtx = this.noiseCanvas.getContext('2d');
            this.noiseCanvas.width = 256;
            this.noiseCanvas.height = 256;
        }

        renderNoise() {
            if (!this.noiseCtx) return;
            const imgData = this.noiseCtx.createImageData(256, 256);
            const d = imgData.data;
            for (let i = 0; i < d.length; i += 4) {
                const c = Math.random() * 255;
                d[i] = c; d[i+1] = c; d[i+2] = c; d[i+3] = 255;
            }
            this.noiseCtx.putImageData(imgData, 0, 0);
        }

        updateSeedLabel() {
            const el = document.getElementById('seed-label');
            if (el) el.textContent = 'SEMILLA: ' + (this.roomCode !== null ? this.roomCode : this.worldSeed);
        }

        initUI() {
            // Version en el menu principal y en el HUD (unica fuente: GAME_VERSION)
            const mv = document.getElementById('menu-version');
            if (mv) mv.textContent = 'THE BACKROOMS v' + GAME_VERSION;
            const hv = document.getElementById('hud-version');
            if (hv) hv.textContent = 'v' + GAME_VERSION;

            // Recuerda el nombre entre partidas
            const nameInput = document.getElementById('name-input');
            if (nameInput) {
                try { nameInput.value = localStorage.getItem('backrooms-name') || ''; } catch (e) { /* noop */ }
            }

            // Dado: rellena el campo con una semilla aleatoria nueva
            const seedInputEl = document.getElementById('seed-input');
            const randomSeedBtn = document.getElementById('btn-random-seed');
            if (randomSeedBtn) {
                randomSeedBtn.onclick = () => {
                    if (!seedInputEl) return;
                    seedInputEl.value = String((1 + Math.floor(Math.random() * 0xFFFFFFFE)) >>> 0);
                };
            }

            document.getElementById('btn-start').onclick = () => {
                audio.init();

                // Semilla personalizada: si el campo del menu trae una semilla
                // distinta, se regenera TODO el mundo antes de empezar.
                // Las semillas NUMERICAS se usan tal cual (escribir "1" genera
                // la semilla 1, no un hash que siempre lleva al mismo mundo de
                // siempre); los textos se convierten con un hash estable y
                // ADEMAS se normalizan (minusculas, sin tildes): "Casa" y
                // "CÁSA" generan el MISMO mundo, asi nadie acaba en una sala
                // distinta por escribir la semilla de otra forma.
                const seedInput = document.getElementById('seed-input');
                const seedText = seedInput ? seedInput.value.trim() : '';
                const normSeed = seedText.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                const seedIsNum = /^\d+$/.test(normSeed);
                if (normSeed) {
                    const seed = seedIsNum ? (parseInt(normSeed, 10) >>> 0) : stringSeed(normSeed);
                    if (seed !== this.worldSeed) {
                        this.worldSeed = seed;
                        this.worldSystem.rebuild(seed);
                        this.setupRandomSpawn();
                        // Los cuerpos fisicos apuntaban a muebles del mundo viejo
                        this.furnitureBodies = [];
                        this.syncFurnitureBodies();
                    }
                    // Codigo de sala: el texto con letras se comparte tal cual
                    // (saneado para los topicos MQTT); las numericas, el numero.
                    this.roomCode = seedIsNum ? seed : (normSeed.replace(/[^a-z0-9_-]/g, '') || seed);
                    this.updateSeedLabel();
                }

                // Multijugador: la SEMILLA es el codigo de sala. Quienes usen
                // la misma semilla (o el mismo codigo mostrado en el HUD)
                // caen en el mismo backroom, hasta 6 exploradores.
                const nameInput = document.getElementById('name-input');
                const name = nameInput ? nameInput.value.trim() : '';
                if (name) {
                    try { localStorage.setItem('backrooms-name', name); } catch (e) { /* noop */ }
                }
                this.net.join(this.roomCode !== null ? this.roomCode : this.worldSeed, name);

                document.getElementById('start-menu').style.display = 'none';
                document.getElementById('hud').style.display = 'flex';
                this.gameActive = true;
                if (IS_TOUCH) {
                    this.notify('🕹 IZQ.: mover · DERECHA: mirar · Toque rápido: interactuar');
                } else {
                    document.body.requestPointerLock();
                }
            };

            // En movil las ranuras del cinturón se tocan directamente
            if (IS_TOUCH) {
                for (let i = 1; i <= 4; i++) {
                    const slotEl = document.getElementById(`slot-${i}`);
                    if (slotEl) slotEl.addEventListener('touchstart', (e) => {
                        e.preventDefault();
                        if (this.gameActive) this.selectSlot(i);
                    });
                }
            }

            document.getElementById('btn-close-notebook').onclick = () => this.toggleNotebook();
            const closeNbX = document.getElementById('btn-close-notebook-x');
            if (closeNbX) closeNbX.onclick = () => this.toggleNotebook();
            document.getElementById('btn-close-map').onclick = () => this.toggleMap();
            // Chat: Enter envia, Escape cierra, boton ENVIAR tambien
            const chatInput = document.getElementById('chat-input');
            if (chatInput) {
                chatInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') { e.preventDefault(); this.sendChat(); }
                    else if (e.key === 'Escape') { e.preventDefault(); this.toggleChat(false); }
                });
            }
            const chatSend = document.getElementById('chat-send');
            if (chatSend) chatSend.addEventListener('click', () => this.sendChat());
            document.getElementById('btn-map-zoom-in').onclick = () => this.mapZoom(1.35);
            document.getElementById('btn-map-zoom-out').onclick = () => this.mapZoom(1 / 1.35);
            document.getElementById('btn-map-center').onclick = () => this.mapCenterOnPlayer();
            this.initMapCanvas();

            document.getElementById('vol-slider').oninput = (e) => {
                audio.setMasterVolume(parseFloat(e.target.value));
            };

            document.getElementById('btn-respawn').onclick = () => {
                location.reload();
            };
        }

        selectSlot(slot) {
            this.inventory.currentSlot = slot;
            for (let i = 1; i <= 4; i++) {
                const el = document.getElementById(`slot-${i}`);
                if (el) el.classList.toggle('selected', i === slot);
            }
        }

        triggerCameraFlash() {
            if (!this.inventory.hasCamera || this.inventory.flashCharges <= 0) return;
            this.inventory.flashCharges--;
            document.getElementById('camera-status-label').textContent = `FLASH [${this.inventory.flashCharges}]`;

            audio.playCameraFlash();
            const flashOverlay = document.getElementById('camera-flash');
            flashOverlay.style.opacity = '1';
            setTimeout(() => { flashOverlay.style.opacity = '0'; }, 80);

            this.flashLight.intensity = 11.0;
            const fade = setInterval(() => {
                this.flashLight.intensity *= 0.8;
                if (this.flashLight.intensity < 0.05) {
                    this.flashLight.intensity = 0;
                    clearInterval(fade);
                }
            }, 50);

            // Aturde a la entidad (local) y avisa a la sala: el flash de
            // cualquier jugador aturde al monstruo para todos
            const camDir = new THREE.Vector3();
            this.camera.getWorldDirection(camDir);
            if (this.entity.active) {
                const toEntity = this.entity.pos.clone().sub(this.camera.position);
                const dot = camDir.dot(toEntity.clone().normalize());
                if (dot > 0.45 && toEntity.length() < 24) {
                    this.entity.stun(4.0);
                }
            }
            this.net.requestStun(this.camera.position, camDir);
        }

        drinkAlmondWater() {
            if (this.inventory.almondWaterCount <= 0) return;
            this.inventory.almondWaterCount--;
            document.getElementById('almond-count-label').textContent = `${this.inventory.almondWaterCount} BOT.`;

            audio.playDrink();
            this.player.sanity = Math.min(100, this.player.sanity + 40);
            this.player.stamina = 100;
            this.updateSanityHUD();
        }

        handleInteraction() {
            if (this.inventory.currentSlot === 3 && this.inventory.almondWaterCount > 0) {
                this.drinkAlmondWater();
                return;
            }

            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
            const hits = raycaster.intersectObjects(this.scene.children, true);

            for (let hit of hits) {
                if (hit.distance < 2.6) {
                    let done = false;
                    for (let p of this.worldSystem.pickups) {
                        if (!p.collected && (p.mesh === hit.object || p.mesh.children.includes(hit.object))) {
                            p.collected = true;
                            // Objetos de cajon: hijo del cajon, no de la escena
                            (p.mesh.parent || this.scene).remove(p.mesh);
                            // Cada objeto es DE UN SOLO jugador: se reclama por
                            // red y desaparece para toda la sala
                            if (p.id) this.net.claimPickup(p.id);

                            if (p.type === 'camera') {
                                this.inventory.hasCamera = true;
                                this.inventory.flashCharges += 3;
                                document.getElementById('camera-status-label').textContent = `FLASH [${this.inventory.flashCharges}]`;
                                document.getElementById('camera-status-label').style.color = '#edd782';
                                audio.playCameraFlash();
                                this.notify('📷 CÁMARA ANALÓGICA · +3 FLASH');
                            } else if (p.type === 'chalk') {
                                this.inventory.hasChalk = true;
                                this.inventory.chalkColor = p.color;
                                this.inventory.chalkColorName = p.colorName;
                                this.inventory.chalkPoints = 100;
                                document.getElementById('chalk-color-label').textContent = p.colorName;
                                document.getElementById('chalk-color-label').style.color = p.color;
                                this.updateChalkHUD();
                                audio.playChalkScratch();
                                this.notify(`✏️ TIZA ${p.colorName} · 100%`);
                            } else if (p.type === 'almond') {
                                this.inventory.almondWaterCount++;
                                document.getElementById('almond-count-label').textContent = `${this.inventory.almondWaterCount} BOT.`;
                                audio.playDrink();
                                this.notify('🥤 AGUA DE ALMENDRAS (+1)');
                            } else if (p.type === 'battery') {
                                if (this.inventory.flashBattery < 100) {
                                    this.inventory.flashBattery = 100;
                                    this.notify('🔋 LINTERNA RECARGADA AL 100%');
                                } else {
                                    this.inventory.batteries = Math.min(9, this.inventory.batteries + 1);
                                    this.notify(`🔋 PILA DE REPUESTO (${this.inventory.batteries})`);
                                }
                                audio.playSwitchClick();
                                this.updateFlashlightHUD();
                            } else if (p.type === 'note') {
                                this.addLoreNote(p.text, p.noteIndex);
                            }
                            done = true;
                            break;
                        }
                    }
                    if (done) return;
                    // Puerta de metal de la SALA DE SEGURIDAD: [E] abre/cierra
                    // (con pila); sin pila, [E] recarga con una de repuesto.
                    // Tambien se activa desde el panel de control (la pantalla
                    // donde se ve la pila restante). Y los MONITORES: [E]
                    // cambia la camara que retransmiten a la siguiente.
                    for (const r of this.worldSystem.securityRooms) {
                        if (!r.doorModel) continue;
                        let o = hit.object;
                        let hitDoor = false;
                        let hitMon = null;
                        while (o) {
                            if (o === r.doorModel || o === r.panelGroup) { hitDoor = true; break; }
                            if (r.monitors && r.monitors.includes(o)) { hitMon = o; break; }
                            o = o.parent;
                        }
                        if (hitMon) {
                            const cams = this.worldSystem.cameras;
                            if (cams.length > 1) {
                                const idx = r.monitors.indexOf(hitMon);
                                r._monPicks = r._monPicks || [0, 1, 2];
                                r._monPicks[idx] = (r._monPicks[idx] + 1) % Math.min(cams.length, 3);
                                this.notify('📹 CAM ' + String(r._monPicks[idx] + 1).padStart(2, '0'));
                                audio.playSwitchClick();
                            } else {
                                this.notify('📹 SOLO HAY UNA CÁMARA EN EL NIVEL');
                            }
                            return;
                        }
                        if (!hitDoor) continue;
                        if (r.state.battery <= 0) {
                            if (this.inventory.batteries > 0) {
                                this.inventory.batteries--;
                                r.state.battery = 100;
                                this.notify('🔋 PILA PUESTA EN LA PUERTA · 100%');
                                audio.playSwitchClick();
                                this.updateFlashlightHUD();
                            } else {
                                this.notify('⚡ SIN PILAS · busca pilas para recargar la puerta');
                            }
                        } else {
                            r.state.doorOpen = !r.state.doorOpen;
                            this.doorStates.set(r.id, r.state.doorOpen);
                            this.net.publishDoor(r.id, r.state.doorOpen);
                            audio.playSwitchClick();
                            this.notify(r.state.doorOpen ? '🚪 PUERTA ABIERTA' : '🚪 PUERTA CERRADA');
                        }
                        this.worldSystem.rebuildUnions();
                        return;
                    }
                    // Cajones de las mesas: [E] los abre; a veces esconden un
                    // objeto que se materializa como pickup reclamable por red
                    for (const b of this.furnitureBodies) {
                        const ud = b.mesh.userData;
                        if (!ud || !ud.drawer || ud.drawer.open) continue;
                        if (b.mesh === hit.object || b.mesh.children.includes(hit.object)) {
                            ud.drawer.open = true;
                            audio.playSwitchClick();
                            // Cajones GLOBALES: la sala entera ve el cajon
                            // abierto (y el objeto, si lo habia)
                            if (b.fid) this.net.publishDrawer(b.fid);
                            if (ud.drawer.itemType) {
                                this.worldSystem.spawnDrawerPickup(b.mesh, ud.drawer);
                                this.notify('📦 ¡EL CAJÓN ESCONDÍA ALGO!');
                            } else {
                                this.notify('📦 Cajón vacío');
                            }
                            return;
                        }
                    }
                }
            }
        }

        addLoreNote(noteText, noteIndex) {
            // Cada nota del lore solo se recoge una vez en toda la partida
            if (noteIndex !== undefined) {
                if (this.worldSystem.collectedNoteIndices.has(noteIndex)) {
                    this.notify('📓 NOTA YA CONOCIDA');
                    return;
                }
                this.worldSystem.collectedNoteIndices.add(noteIndex);
            }
            this.inventory.notesCollected++;
            const ncl = document.getElementById('notes-count-label');
            if (ncl) ncl.textContent = `NOTAS: ${this.inventory.notesCollected} / ${this.inventory.totalNotes}`;

            const notebookDiv = document.getElementById('notebook-text');
            const entry = document.createElement('div');
            entry.className = 'note-entry';
            entry.innerHTML = `<h4>// NOTA RECOGIDA #${this.inventory.notesCollected}</h4><p>${noteText}</p>`;
            notebookDiv.appendChild(entry);
            audio.playChalkScratch();
            this.notify(`📓 NOTA RECOGIDA (${this.inventory.notesCollected}/${this.inventory.totalNotes})`);
        }

        toggleNotebook() {
            const modal = document.getElementById('notebook-modal');
            const isOpen = modal.style.display === 'flex';
            modal.style.display = isOpen ? 'none' : 'flex';
            if (!isOpen) {
                // Abrir el cuaderno cierra el mapa (y viceversa)
                const mapM = document.getElementById('map-modal');
                if (mapM && mapM.style.display === 'flex') { mapM.style.display = 'none'; this.mapOpen = false; }
            }
            if (IS_TOUCH) return;   // en movil no hay pointer lock que liberar
            if (!isOpen) document.exitPointerLock();
            else document.body.requestPointerLock();
        }

        // ---- MAPA COMPARTIDO --------------------------------------------
        // Marca exploradas las celdas alrededor del jugador (radio de 2
        // celdas): el mapa se desbloquea con la exploracion, la de cada uno y
        // la de la sala entera (bitsets sincronizados por MQTT).
        markExplored() {
            const p = this.player.pos;
            const C = 2.8, N = 16, CS = N * C;
            const gx = Math.floor(p.x / CS);
            const gz = Math.floor(p.z / CS);
            const cx = Math.floor((p.x - gx * CS) / C);
            const cz = Math.floor((p.z - gz * CS) / C);
            let dirty = false;
            for (let dx = -2; dx <= 2; dx++) {
                for (let dz = -2; dz <= 2; dz++) {
                    const x = cx + dx, z = cz + dz;
                    if (x < 0 || x >= N || z < 0 || z >= N) continue;
                    let bits = this.exploredChunks.get(gx + ',' + gz);
                    if (!bits) {
                        bits = new Uint8Array(32);
                        this.exploredChunks.set(gx + ',' + gz, bits);
                    }
                    const idx = x * N + z;
                    if (!(bits[idx >> 3] & (1 << (idx & 7)))) {
                        bits[idx >> 3] |= (1 << (idx & 7));
                        dirty = true;
                    }
                }
            }
            if (dirty) this.mapDirty = true;
        }

        // Fusiona los chunks explorados que llegan de otros jugadores
        mergeMapData(list) {
            if (!Array.isArray(list)) return;
            for (const c of list) {
                if (!Array.isArray(c) || c.length < 3) continue;
                let bits = this.exploredChunks.get(c[0] + ',' + c[1]);
                if (!bits) {
                    bits = new Uint8Array(32);
                    this.exploredChunks.set(c[0] + ',' + c[1], bits);
                }
                const s = String(c[2]);
                // El emisor empaqueta pares de bytes como 4 digitos hex:
                // primero se reconstruyen los 32 bytes y luego se expanden
                // los 256 bits (idx = x*16+z)
                const bytes = new Uint8Array(32);
                for (let i = 0; i < 64; i += 2) {
                    bytes[i / 2] = parseInt(s.substr(i, 2), 16) || 0;
                }
                for (let by = 0; by < 32; by++) {
                    for (let p = 0; p < 8; p++) {
                        if (bytes[by] & (1 << p)) {
                            const idx = by * 8 + p;
                            bits[idx >> 3] |= (1 << (idx & 7));
                        }
                    }
                }
            }
        }

        toggleMap() {
            const modal = document.getElementById('map-modal');
            if (!modal) return;
            const isOpen = modal.style.display === 'flex';
            if (!isOpen) {
                const nb = document.getElementById('notebook-modal');
                if (nb && nb.style.display === 'flex') nb.style.display = 'none';
                modal.style.display = 'flex';
                this.mapOpen = true;
                this.mapView.x = this.player.pos.x;
                this.mapView.z = this.player.pos.z;
                this.renderMap();
                if (IS_TOUCH) return;
                document.exitPointerLock();
            } else {
                modal.style.display = 'none';
                this.mapOpen = false;
                if (!IS_TOUCH) document.body.requestPointerLock();
            }
        }

        mapZoom(f) {
            this.mapView.zoom = Math.max(3, Math.min(26, this.mapView.zoom * f));
            this.renderMap();
        }

        mapCenterOnPlayer() {
            this.mapView.x = this.player.pos.x;
            this.mapView.z = this.player.pos.z;
            this.renderMap();
        }

        renderMap() {
            const canvas = document.getElementById('map-canvas');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const W = canvas.width, H = canvas.height;
            const zoom = this.mapView.zoom;
            const C = 2.8, N = 16, CS = N * C;
            ctx.fillStyle = '#0c0f0a';
            ctx.fillRect(0, 0, W, H);

            // Rejilla sutil de chunks
            ctx.strokeStyle = 'rgba(255,255,255,0.035)';
            ctx.lineWidth = 1;
            const g0x = Math.floor((this.mapView.x - (W / 2) / zoom) / CS);
            const g1x = Math.ceil((this.mapView.x + (W / 2) / zoom) / CS);
            const g0z = Math.floor((this.mapView.z - (H / 2) / zoom) / CS);
            const g1z = Math.ceil((this.mapView.z + (H / 2) / zoom) / CS);
            for (let gx = g0x; gx <= g1x; gx++) {
                const sx = Math.round(W / 2 + (gx * CS - this.mapView.x) * zoom);
                ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); ctx.stroke();
            }
            for (let gz = g0z; gz <= g1z; gz++) {
                const sy = Math.round(H / 2 + (gz * CS - this.mapView.z) * zoom);
                ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(W, sy); ctx.stroke();
            }

            // Celdas exploradas (niebla de guerra: solo lo visto por la sala).
            // El suelo se pinta por celdas pero los MUROS se dibujan con sus
            // cajas REALES (paredes finas, pilares, tabiques inclinados y
            // curvas): antes se pintaba la celda entera de negro y el mapa
            // mostraba bloques macizos por los que en realidad se podia
            // caminar ("voy por las partes negras y no es real").
            const cell = C * zoom;
            for (const [key, bits] of this.exploredChunks) {
                const [gx, gz] = key.split(',').map(Number);
                const sx0 = W / 2 + (gx * CS - this.mapView.x) * zoom;
                const sy0 = H / 2 + (gz * CS - this.mapView.z) * zoom;
                if (sx0 + CS * zoom < -50 || sx0 > W + 50 || sy0 + CS * zoom < -50 || sy0 > H + 50) continue;
                let ch = this.worldSystem.chunks.get(key);
                if (!ch || !ch.grid) ch = this.worldSystem.getLayout(gx, gz);
                const g = ch.grid;
                const isExplored = (x, z) => {
                    if (x < 0 || x >= N || z < 0 || z >= N) return false;
                    const idx = x * N + z;
                    return !!(bits[idx >> 3] & (1 << (idx & 7)));
                };
                // Suelo explorado (incluida la celda de los pilares: el mapa
                // ya no la pinta entera de negro)
                ctx.fillStyle = '#2d3122';
                for (let x = 0; x < N; x++) {
                    for (let z = 0; z < N; z++) {
                        if (!isExplored(x, z)) continue;
                        const v = g[x][z];
                        if (v === 0 || v === 2 || v === 3) {
                            ctx.fillRect(Math.round(sx0 + x * cell), Math.round(sy0 + z * cell),
                                Math.max(1, Math.ceil(cell - 0.7)), Math.max(1, Math.ceil(cell - 0.7)));
                        }
                    }
                }
                ctx.fillStyle = '#090b07';
                if (ch.wallBoxes && ch.wallBoxes.length) {
                    // Paredes REALES (finas, curvas, tabiques inclinados y
                    // pilares) desde las cajas de colision. Las cajas se
                    // CONSERVAN aunque el chunk este descargado (world.js ya
                    // no las borra al descargar): antes, al alejarse, el mapa
                    // caia a la aproximacion por rejilla y dibujaba muros que
                    // no existian en el 3D ("puedo estar en una pared que el
                    // mapa dice que no existe").
                    const isSlabBox = (b) => {
                        // Las cajas de colision POR SEGMENTO de los tabiques
                        // inclinados se saltan: son AABBs de segmentos rotados
                        // que en el mapa parecian "hitboxes cuadrados" (la
                        // escalera de cuadrados alrededor de la diagonal, con
                        // huecos de suelo entre ellos). El tabique se dibuja
                        // rotado mas abajo con su angulo real y solo el.
                        if (!ch.slantedBoxes || !ch.slantedBoxes.length) return false;
                        for (const s of ch.slantedBoxes) {
                            if (Math.abs(b.minX - s.minX) < 0.02 && Math.abs(b.maxX - s.maxX) < 0.02 &&
                                Math.abs(b.minZ - s.minZ) < 0.02 && Math.abs(b.maxZ - s.maxZ) < 0.02) return true;
                        }
                        return false;
                    };
                    for (const b of ch.wallBoxes) {
                        if (isSlabBox(b)) continue;
                        const lcx = Math.floor(((b.minX + b.maxX) / 2 - gx * CS) / C);
                        const lcz = Math.floor(((b.minZ + b.maxZ) / 2 - gz * CS) / C);
                        if (!isExplored(lcx, lcz)) continue;
                        const bx = Math.round(W / 2 + ((b.minX + b.maxX) / 2 - this.mapView.x) * zoom);
                        const bz = Math.round(H / 2 + ((b.minZ + b.maxZ) / 2 - this.mapView.z) * zoom);
                        const bw = Math.max(1, Math.round((b.maxX - b.minX) * zoom));
                        const bh = Math.max(1, Math.round((b.maxZ - b.minZ) * zoom));
                        ctx.fillRect(bx - Math.floor(bw / 2), bz - Math.floor(bh / 2), bw, bh);
                    }
                    // TABIQUES INCLINADOS con su ANGULO REAL (rectangulo
                    // rotado): antes el mapa pintaba las cajas AABB de su
                    // colision y las paredes en diagonal parecian escalones
                    // de cuadrados.
                    if (ch.slantedWalls && ch.slantedWalls.length) {
                        for (const s of ch.slantedWalls) {
                            const lcx = Math.floor((s.cx - gx * CS) / C);
                            const lcz = Math.floor((s.cz - gz * CS) / C);
                            if (!isExplored(lcx, lcz)) continue;
                            ctx.save();
                            ctx.translate(W / 2 + (s.cx - this.mapView.x) * zoom, H / 2 + (s.cz - this.mapView.z) * zoom);
                            ctx.rotate(-s.ang);
                            ctx.fillStyle = '#090b07';
                            ctx.fillRect(-Math.max(1, s.L * zoom) / 2, -Math.max(1, Math.max(s.T0, s.T1) * zoom) / 2,
                                Math.max(1, s.L * zoom), Math.max(1, Math.max(s.T0, s.T1) * zoom));
                            ctx.restore();
                        }
                    }
                    // SALAS DE SEGURIDAD: marcador propio (una "S" en un
                    // cuadrado dorado) cuando el jugador ya ha explorado la
                    // sala.
                    if (ch.securityRooms && ch.securityRooms.length) {
                        for (const r of ch.securityRooms) {
                            const cxc = (r.minX + r.maxX) / 2;
                            const czc = (r.minZ + r.maxZ) / 2;
                            const lcx = Math.floor((cxc - gx * CS) / C);
                            const lcz = Math.floor((czc - gz * CS) / C);
                            if (!isExplored(lcx, lcz)) continue;
                            const mx = W / 2 + (cxc - this.mapView.x) * zoom;
                            const mz = H / 2 + (czc - this.mapView.z) * zoom;
                            ctx.fillStyle = '#c9a53c';
                            ctx.strokeStyle = '#201805';
                            ctx.lineWidth = 1.5;
                            ctx.fillRect(mx - 5, mz - 5, 10, 10);
                            ctx.strokeRect(mx - 5, mz - 5, 10, 10);
                            ctx.fillStyle = '#201805';
                            ctx.font = 'bold 9px Courier New';
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'middle';
                            ctx.fillText('S', mx, mz + 0.5);
                        }
                    }
                } else {
                    // Chunk lejano (descargado): muros aproximados como en el
                    // 3D real (buildChunkMeshes). Antes se pintaba un cuadrado
                    // en TODA celda de muro y el mapa mostraba manchas negras
                    // que en el juego eran suelo libre (postes aislados que el
                    // 3D elimina) o muros desplazados (la junta del borde
                    // salia centrada en la celda): "cosas negras que no son
                    // las paredes reales".
                    const T = 0.6;
                    const TH = T / C / 2;   // medio grosor en fraccion de celda
                    const isOpen = (xx, zz) => xx >= 0 && xx < N && zz >= 0 && zz < N && (g[xx][zz] === 0 || g[xx][zz] === 2);
                    const isWall = (xx, zz) => xx >= 0 && xx < N && zz >= 0 && zz < N && g[xx][zz] === 1;
                    for (let x = 0; x < N; x++) {
                        for (let z = 0; z < N; z++) {
                            if (g[x][z] !== 1 || !isExplored(x, z)) continue;
                            const openW = isOpen(x - 1, z), openE = isOpen(x + 1, z);
                            const openN = isOpen(x, z - 1), openS = isOpen(x, z + 1);
                            const paint = (x0r, z0r, x1r, z1r) => {
                                ctx.fillRect(Math.round(sx0 + x0r), Math.round(sy0 + z0r),
                                    Math.max(1, Math.ceil(x1r - x0r)), Math.max(1, Math.ceil(z1r - z0r)));
                            };
                            if (x === 0 || x === N - 1 || z === 0 || z === N - 1) {
                                // Junta entre chunks: franja pegada al borde
                                // (en las esquinas, las dos franjas)
                                if (x === 0) paint(0, 0, TH * 2 * cell, cell);
                                else if (x === N - 1) paint(cell - TH * 2 * cell, 0, cell, cell);
                                if (z === 0) paint(0, 0, cell, TH * 2 * cell);
                                else if (z === N - 1) paint(0, cell - TH * 2 * cell, cell, cell);
                            } else if ((openW || openE) && (openN || openS)) {
                                // Poste de esquina/final: cuadrado SOLO si toca
                                // una pared real (los aislados se eliminan en
                                // el 3D y no deben pintarse)
                                if (!isWall(x - 1, z) && !isWall(x + 1, z) && !isWall(x, z - 1) && !isWall(x, z + 1)) continue;
                                paint((x + 0.5 - TH) * cell, (z + 0.5 - TH) * cell, (x + 0.5 + TH) * cell, (z + 0.5 + TH) * cell);
                            } else if (openW || openE) {
                                // Lamina 'x' (corre a lo largo de Z)
                                paint((x + 0.5 - TH) * cell, z * cell, (x + 0.5 + TH) * cell, (z + 1) * cell);
                            } else if (openN || openS) {
                                // Lamina 'z' (corre a lo largo de X)
                                paint(x * cell, (z + 0.5 - TH) * cell, (x + 1) * cell, (z + 0.5 + TH) * cell);
                            } else {
                                // Nucleo macizo: celda entera (bloque solido 3D)
                                paint(0, 0, cell, cell);
                            }
                        }
                    }
                    // Pilares de chunks lejanos: cuadrados finos
                    ctx.fillStyle = '#191b13';
                    for (let x = 0; x < N; x++) {
                        for (let z = 0; z < N; z++) {
                            if (g[x][z] !== 3 || !isExplored(x, z)) continue;
                            const s = 0.45 * cell;
                            ctx.fillRect(Math.round(sx0 + (x + 0.5) * cell - s / 2),
                                Math.round(sy0 + (z + 0.5) * cell - s / 2), Math.max(1, s), Math.max(1, s));
                        }
                    }
                    ctx.fillStyle = '#090b07';
                }
                // SALA DE SEGURIDAD en un chunk LEJANO (layout determinista,
                // sin cargar el chunk): mismo marcador dorado "S" que en los
                // chunks cargados, si la celda de la sala ya esta explorada.
                if (ch.securityRoom && !(ch.securityRooms && ch.securityRooms.length)) {
                    const sr = ch.securityRoom;
                    const cxc = gx * CS + (sr.rx + sr.w / 2) * C;
                    const czc = gz * CS + (sr.rz + sr.h / 2) * C;
                    const lcx = Math.floor((cxc - gx * CS) / C);
                    const lcz = Math.floor((czc - gz * CS) / C);
                    if (isExplored(lcx, lcz)) {
                        const mx = W / 2 + (cxc - this.mapView.x) * zoom;
                        const mz = H / 2 + (czc - this.mapView.z) * zoom;
                        ctx.fillStyle = '#c9a53c';
                        ctx.strokeStyle = '#201805';
                        ctx.lineWidth = 1.5;
                        ctx.fillRect(mx - 5, mz - 5, 10, 10);
                        ctx.strokeRect(mx - 5, mz - 5, 10, 10);
                        ctx.fillStyle = '#201805';
                        ctx.font = 'bold 9px Courier New';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText('S', mx, mz + 0.5);
                    }
                }
            }

            // PUNTOS ESPECIALES ALEATORIOS: el mapa revela de vez en cuando
            // (determinista: toda la sala ve los mismos) la posicion aproximada
            // de una sala de seguridad AUN NO explorada, con un "?" rojo
            // parpadeante. Cuando alguien la explora, el "?" se convierte en
            // el marcador dorado "S".
            const pcx = Math.floor(this.player.pos.x / CS);
            const pcz = Math.floor(this.player.pos.z / CS);
            if (!this._specialRooms || this._specialRooms.cx !== pcx || this._specialRooms.cz !== pcz) {
                const rooms = [];
                for (let dx = -3; dx <= 3; dx++) {
                    for (let dz = -3; dz <= 3; dz++) {
                        const lc = this.worldSystem.getLayout(pcx + dx, pcz + dz);
                        if (!lc.securityRoom) continue;
                        const sr = lc.securityRoom;
                        if ((hash2((pcx + dx) * 7 + 3, (pcz + dz) * 11 + 5) & 3) === 0) {
                            rooms.push({
                                x: (pcx + dx) * CS + (sr.rx + sr.w / 2) * C,
                                z: (pcz + dz) * CS + (sr.rz + sr.h / 2) * C,
                                gx: pcx + dx, gz: pcz + dz
                            });
                        }
                    }
                }
                this._specialRooms = { cx: pcx, cz: pcz, rooms };
            }
            for (const r of this._specialRooms.rooms) {
                const bits2 = this.exploredChunks.get(r.gx + ',' + r.gz);
                const lx2 = Math.floor((r.x - r.gx * CS) / C);
                const lz2 = Math.floor((r.z - r.gz * CS) / C);
                const explored = !!bits2 && lx2 >= 0 && lx2 < N && lz2 >= 0 && lz2 < N &&
                    !!(bits2[(lx2 * N + lz2) >> 3] & (1 << ((lx2 * N + lz2) & 7)));
                if (explored) continue;
                const mx = W / 2 + (r.x - this.mapView.x) * zoom;
                const mz = H / 2 + (r.z - this.mapView.z) * zoom;
                ctx.save();
                ctx.globalAlpha = 0.7 + 0.3 * Math.sin(performance.now() * 0.003);
                ctx.strokeStyle = '#e03a2e';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([4, 3]);
                ctx.beginPath();
                ctx.arc(mx, mz, 8, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = '#e03a2e';
                ctx.font = 'bold 11px Courier New';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('?', mx, mz + 0.5);
                ctx.restore();
            }

            // Marcador del jugador (flecha verde, orientada a su mirada)
            const px = (wx) => W / 2 + (wx - this.mapView.x) * zoom;
            const pz = (wz) => H / 2 + (wz - this.mapView.z) * zoom;
            const p = this.player.pos;
            ctx.save();
            ctx.translate(px(p.x), pz(p.z));
            ctx.rotate(-this.yaw);
            ctx.fillStyle = '#57d957';
            ctx.strokeStyle = '#0a0f0a';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 3.5); ctx.lineTo(-6, 7);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // Compañeros de sala (puntos azules con inicial)
            ctx.font = 'bold 8px Courier New';
            for (const [pid, pp] of this.net.peers) {
                if (!pp || !pp.hasState) continue;
                ctx.fillStyle = '#4da6ff';
                ctx.beginPath();
                ctx.arc(px(pp.x), pz(pp.z), 5, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#0a0f0a';
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.fillStyle = '#dfeaff';
                ctx.fillText((pp.name || '?').charAt(0), px(pp.x) - 2.5, pz(pp.z) + 3);
            }

            // Entidad (rojo): posicion conocida (host la simula o espectro sync)
            const entPos = (this.net.entityActive && this.net.entityGhost)
                ? this.net.entityGhost.position
                : (this.entity && this.entity.active ? this.entity.pos : null);
            if (entPos) {
                const g = entPos;
                ctx.fillStyle = '#e03a2e';
                ctx.beginPath();
                ctx.arc(px(g.x), pz(g.z), 7, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#200805';
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.fillStyle = '#ffd9d4';
                ctx.font = 'bold 9px Courier New';
                ctx.fillText('!', px(g.x) - 2.5, pz(g.z) + 3);
            }

            // Marco
            ctx.strokeStyle = 'rgba(255,255,255,0.08)';
            ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
        }

        initMapCanvas() {
            const canvas = document.getElementById('map-canvas');
            if (!canvas) return;
            let dragging = false, px0 = 0, py0 = 0;
            const startPan = (x, y) => { dragging = true; px0 = x; py0 = y; };
            const movePan = (x, y) => {
                if (!dragging) return;
                this.mapView.x -= (x - px0) / this.mapView.zoom;
                this.mapView.z -= (y - py0) / this.mapView.zoom;
                px0 = x; py0 = y;
                this.renderMap();
            };
            const endPan = () => { dragging = false; };
            canvas.addEventListener('touchstart', (e) => { e.preventDefault(); startPan(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
            canvas.addEventListener('touchmove', (e) => { e.preventDefault(); movePan(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
            canvas.addEventListener('touchend', (e) => { e.preventDefault(); endPan(); }, { passive: false });
            canvas.addEventListener('touchcancel', () => endPan());
            canvas.addEventListener('mousedown', (e) => { e.preventDefault(); startPan(e.clientX, e.clientY); });
            window.addEventListener('mousemove', (e) => movePan(e.clientX, e.clientY));
            window.addEventListener('mouseup', () => endPan());
            canvas.addEventListener('wheel', (e) => {
                e.preventDefault();
                this.mapZoom(e.deltaY < 0 ? 1.15 : 1 / 1.15);
            }, { passive: false });
        }

        updateSanityHUD() {
            const fill = document.getElementById('sanity-fill');
            const num = document.getElementById('sanity-num');
            const s = Math.max(0, Math.round(this.player.sanity));
            fill.style.width = `${s}%`;
            num.textContent = `${s}%`;

            if (s > 60) fill.style.backgroundColor = '#8fa336';
            else if (s > 25) fill.style.backgroundColor = '#bfa034';
            else fill.style.backgroundColor = '#a82c2c';
        }

        // Coordenadas reales del jugador (mundo infinito: X/Z en metros, Y altura)
        updateCoordsHUD() {
            const el = document.getElementById('coords-label');
            if (!el) return;
            const p = this.player.pos;
            const fmt = (v) => (v < 0 ? '-' : '+') + Math.abs(v).toFixed(1).padStart(5, '0');
            const txt = `POS X:${fmt(p.x)} Y:${fmt(p.y)} Z:${fmt(p.z)}`;
            if (txt !== this._lastCoords) {
                this._lastCoords = txt;
                el.textContent = txt;
            }
        }

        updateChalkHUD() {
            const fill = document.getElementById('chalk-fill');
            const label = document.getElementById('chalk-status-label');
            const colorLabel = document.getElementById('chalk-color-label');
            const pct = Math.max(0, Math.round(this.inventory.chalkPoints));
            const exhausted = !this.inventory.hasChalk || pct <= 0;
            if (fill) {
                fill.style.width = `${pct}%`;
                fill.classList.toggle('chalk-low', !exhausted && pct <= 20);
                fill.classList.toggle('chalk-empty', exhausted);
                if (!exhausted) {
                    // Aclarar el color de la tiza para que el medidor se vea incluso con tiza negra
                    const col = new THREE.Color(this.inventory.chalkColor);
                    col.lerp(new THREE.Color(0xffffff), 0.4);
                    fill.style.background = `#${col.getHexString()}`;
                } else {
                    fill.style.background = '#3a3a3a';
                }
            }
            if (label) {
                if (!this.inventory.hasChalk) label.textContent = 'NO DISPONIBLE';
                else if (pct <= 0) label.textContent = 'TIZA AGOTADA';
                else if (pct <= 20) label.textContent = `TIZA: ${pct}% (¡SE ACABA!)`;
                else label.textContent = `TIZA: ${pct}%`;
                label.style.color = pct <= 0 ? '#d15b4a' : (pct <= 20 ? '#e0a020' : '#888');
            }
            if (colorLabel) {
                colorLabel.style.opacity = (this.inventory.hasChalk && pct > 0) ? '1' : '0.3';
            }
        }

        updateChalkDrawing() {
            const isDrawing = this.isMouseDown && this.inventory.currentSlot === 1 && this.inventory.hasChalk && this.inventory.chalkPoints > 0;

            // Si la tiza se agotó, ya no hay nada que sostener en la mano
            const chalkInHand = this.inventory.hasChalk && this.inventory.chalkPoints > 0;
            this.chalkSystem.updateViewModel(
                chalkInHand,
                this.inventory.currentSlot === 1,
                this.inventory.chalkColor,
                isDrawing,
                this.inventory.chalkPoints / 100
            );

            if (!isDrawing) return;

            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
            const hits = raycaster.intersectObjects(this.scene.children, true);

            for (let hit of hits) {
                if (hit.distance < 2.7 && hit.object.material) {
                    // Las paredes curvas y diagonales usan un CLON de
                    // Materials.wall (con DoubleSide): comparar por referencia
                    // fallaba y la tiza no pintaba en las paredes inclinadas.
                    // Se comparan las TEXTURAS compartidas, que si lo son.
                    const m = hit.object.material;
                    const wallish = m.map && (m.map === Materials.wall.map || m.map === Materials.floor.map);
                    if (!wallish) continue;
                    // Normal de la cara: en las paredes de doble cara la normal
                    // de la geometria puede apuntar al lado contrario de la
                    // camara; la tiza quedaria invisible (mirando a la pared
                    // por dentro). Se voltea si apunta en el sentido del rayo.
                    const n = hit.face.normal.clone();
                    if (n.dot(raycaster.ray.direction) > 0) n.negate();
                    if (!this.chalkSystem.lastDrawPoint || this.chalkSystem.lastDrawPoint.distanceTo(hit.point) > 0.05) {
                        this.chalkSystem.addDot(hit.point, n, this.inventory.chalkColor);
                        // Los dibujos de tiza se comparten con toda la sala
                        this.net.queueChalkDot(hit.point, n, this.inventory.chalkColor);
                        this.chalkSystem.lastDrawPoint = hit.point.clone();

                        this.inventory.chalkPoints = Math.max(0, this.inventory.chalkPoints - 0.32);
                        this.updateChalkHUD();

                        if (Math.random() < 0.25) audio.playChalkScratch();
                    }
                    break;
                }
            }
        }

        updateLights(dt) {
            // La luz depende SOLO de la posicion del jugador, nunca de hacia
            // donde apunta la camara: antes la piscina priorizaba las lamparas
            // visibles en pantalla y girar la vista reasignaba los focos, asi
            // que la habitacion se aclaraba u oscurecia al mirar a un lado u
            // otro. Ahora se iluminan siempre las lamparas MAS CERCANAS.
            const sorted = this.worldSystem.lamps.map(l => {
                return { lamp: l, dist: this.camera.position.distanceTo(l.pos) };
            }).sort((a, b) => a.dist - b.dist);

            this.lightPool.forEach((light, i) => {
                if (sorted[i] && sorted[i].dist < 24) {
                    const l = sorted[i].lamp;
                    light.position.copy(l.pos);

                    if (l.state === 1) {
                        // Paneles encendidos: luz continua, visible de lejos.
                        // Un punto mas brillante que antes para que el pasillo
                        // iluminado no se apague entre lampara y lampara.
                        light.intensity = 0.62;
                    } else if (l.state === 2) {
                        l.flickerTimer -= dt;
                        if (l.flickerTimer <= 0) {
                            l.isLitNow = Math.random() < 0.75;
                            l.flickerTimer = Math.random() * 0.25 + 0.05;
                            if (!l.isLitNow && Math.random() < 0.15) audio.flickerHum();
                        }
                        light.intensity = l.isLitNow ? (0.66 + Math.random() * 0.18) : 0.05;
                    }
                } else {
                    light.intensity = 0;
                }
            });
        }

        // Sincroniza los muebles con fisica: los chunks nuevos generan mobiliario
        // mientras exploras, y cada mueble recibe su cuerpo empujable una sola vez
        syncFurnitureBodies() {
            const list = this.worldSystem.dynamicFurniture;
            for (let i = this.furnitureBodies.length; i < list.length; i++) {
                this.addFurnitureBody(list[i].mesh, list[i].x, list[i].z);
            }
        }

        addFurnitureBody(mesh, x, z) {
            const body = {
                mesh,
                spawn: new THREE.Vector3(x, 0, z),
                vel: new THREE.Vector3(0, 0, 0),
                aabb: null,
                wobble: 0,
                impactCd: 0,
                baseRot: new THREE.Euler(mesh.rotation.x, mesh.rotation.y, mesh.rotation.z),
                fid: mesh.userData ? mesh.userData.fid : null
            };
            // Asentado sobre el suelo desde el principio: nunca flota ni levita
            mesh.visible = true;
            mesh.position.set(x, 0, z);
            snapToFloor(mesh, 0);
            // Y base del modelo (las mesas/sillas caidas se asientan con el
            // centro por ENCIMA del suelo). Al aplicar posiciones remotas se
            // conserva: si se forzara y=0, los modelos tumbados se hundian en
            // la moqueta ("las mesas y sillas atraviesan el suelo").
            body.baseY = mesh.position.y;
            this.updateFurnitureAABB(body);
            this.furnitureBodies.push(body);
            return body;
        }

        updateFurnitureAABB(body) {
            body.mesh.updateMatrixWorld(true);
            const bb = new THREE.Box3().setFromObject(body.mesh);
            body.aabb = {
                minX: bb.min.x, maxX: bb.max.x,
                minZ: bb.min.z, maxZ: bb.max.z
            };
        }

        // Física simple de empuje: al chocar el jugador, el mueble se desliza con
        // fricción, choca con paredes y otros muebles y se bambolea un instante.
        updateFurniturePhysics(dt) {
            const bodies = this.furnitureBodies;
            const wallBoxes = this.worldSystem.wallBoxes;

            for (let i = 0; i < bodies.length; i++) {
                const b = bodies[i];
                if (!b.aabb) continue;

                // Solo se simula mobiliario cercano: el infinito no debe frenar el juego
                if (Math.hypot(b.mesh.position.x - this.player.pos.x, b.mesh.position.z - this.player.pos.z) > 32) continue;

                // Cajones de las mesas: se deslizan suavemente al abrir/cerrar
                if (b.mesh.userData && b.mesh.userData.drawer) {
                    const dr = b.mesh.userData.drawer;
                    const target = dr.open ? 0.34 : 0;
                    dr.mesh.position.z += (target - dr.mesh.position.z) * Math.min(1, dt * 7);
                }

                // Fricción: el mueble se detiene solo
                b.vel.x *= Math.max(0, 1 - 3.4 * dt);
                b.vel.z *= Math.max(0, 1 - 3.4 * dt);
                if (Math.abs(b.vel.x) < 0.02) b.vel.x = 0;
                if (Math.abs(b.vel.z) < 0.02) b.vel.z = 0;
                b.impactCd = Math.max(0, b.impactCd - dt);

                const speed = Math.hypot(b.vel.x, b.vel.z);
                const t = performance.now() * 0.001;
                if (speed < 0.01) {
                    b.wobble = Math.max(0, b.wobble - dt * 2.2);
                    // El bamboleo se apaga y el mueble vuelve a su rotación base
                    b.mesh.rotation.x = b.baseRot.x + (b.wobble > 0 ? Math.sin(t * 6 + b.spawn.x) * 0.05 * b.wobble : 0);
                    b.mesh.rotation.z = b.baseRot.z + (b.wobble > 0 ? Math.cos(t * 5.3 + b.spawn.z) * 0.05 * b.wobble : 0);
                    continue;
                }

                b.mesh.position.x += b.vel.x * dt;
                b.mesh.position.z += b.vel.z * dt;
                b.wobble = Math.min(1, b.wobble + dt * 3);
                this.updateFurnitureAABB(b);

                // Colisión con paredes y pilares: resolver por el eje de menor penetración
                for (let w = 0; w < wallBoxes.length; w++) {
                    const box = wallBoxes[w];
                    if (b.aabb.maxX > box.minX && b.aabb.minX < box.maxX &&
                        b.aabb.maxZ > box.minZ && b.aabb.minZ < box.maxZ) {
                        const penX = Math.min(b.aabb.maxX - box.minX, box.maxX - b.aabb.minX);
                        const penZ = Math.min(b.aabb.maxZ - box.minZ, box.maxZ - b.aabb.minZ);
                        if (penX < penZ) {
                            b.mesh.position.x += (b.aabb.maxX - box.minX < box.maxX - b.aabb.minX) ? -penX : penX;
                        } else {
                            b.mesh.position.z += (b.aabb.maxZ - box.minZ < box.maxZ - b.aabb.minZ) ? -penZ : penZ;
                        }
                        if (speed > 1.0 && b.impactCd <= 0) {
                            audio.playFurnitureThud();
                            b.impactCd = 0.9;
                        }
                        b.vel.multiplyScalar(0.55);
                        this.updateFurnitureAABB(b);
                    }
                }

                // Colisión entre muebles (un escritorio empujado no atraviesa una silla)
                for (let j = 0; j < bodies.length; j++) {
                    const o = bodies[j];
                    if (o === b || !o.aabb) continue;
                    if (b.aabb.maxX > o.aabb.minX && b.aabb.minX < o.aabb.maxX &&
                        b.aabb.maxZ > o.aabb.minZ && b.aabb.minZ < o.aabb.maxZ) {
                        const penX = Math.min(b.aabb.maxX - o.aabb.minX, o.aabb.maxX - b.aabb.minX);
                        const penZ = Math.min(b.aabb.maxZ - o.aabb.minZ, o.aabb.maxZ - b.aabb.minZ);
                        if (penX < penZ) {
                            b.mesh.position.x += (b.aabb.maxX - o.aabb.minX < o.aabb.maxX - b.aabb.minX) ? -penX : penX;
                        } else {
                            b.mesh.position.z += (b.aabb.maxZ - o.aabb.minZ < o.aabb.maxZ - b.aabb.minZ) ? -penZ : penZ;
                        }
                        b.vel.multiplyScalar(0.5);
                        this.updateFurnitureAABB(b);
                    }
                }

                // Bamboleo al ser empujado (se apaga solo)
                b.mesh.rotation.x = b.baseRot.x + (b.wobble > 0 ? Math.sin(t * 6 + b.spawn.x) * 0.05 * b.wobble : 0);
                b.mesh.rotation.z = b.baseRot.z + (b.wobble > 0 ? Math.cos(t * 5.3 + b.spawn.z) * 0.05 * b.wobble : 0);
            }
        }

        // ---- MUEBLES GLOBALES (multijugador) ----------------------------
        // Aplica posiciones y cajones que llegan de otros jugadores: si un
        // companero empuja una mesa/silla o abre un cajon, la sala lo ve.
        applyRemoteFurniture(list) {
            if (!Array.isArray(list)) return;
            for (const it of list) {
                if (!it || !it.id) continue;
                const b = this.furnitureBodies.find(x => x.fid === it.id);
                if (!b || !b.mesh) continue;
                if (typeof it.x === 'number' && typeof it.z === 'number') {
                    // y = Y base asentada del modelo: las mesas/sillas caidas
                    // tienen el centro por encima del suelo; forzar y=0 las
                    // hundia en la moqueta cuando llegaba una posicion remota
                    b.mesh.position.set(it.x, b.baseY || b.mesh.position.y, it.z);
                    this.updateFurnitureAABB(b);
                    b._remoteAt = Date.now();
                }
                const ud = b.mesh.userData;
                if (it.d && ud && ud.drawer && !ud.drawer.open) {
                    ud.drawer.open = true;
                    b._remoteAt = Date.now();
                    audio.playSwitchClick();
                    if (ud.drawer.itemType) {
                        const p = this.worldSystem.spawnDrawerPickup(b.mesh, ud.drawer);
                        this.notify(p ? '📦 Un compañero abrió un cajón… ¡había algo!' : '📦 Un compañero abrió un cajón');
                    } else {
                        this.notify('📦 Un compañero abrió un cajón vacío');
                    }
                }
            }
        }

        // ---- CHAT DE SALA ------------------------------------------------
        toggleChat(open) {
            const ui = document.getElementById('chat-ui');
            if (!ui) return;
            const willOpen = open !== undefined ? open : !this.chatOpen;
            ui.classList.toggle('open', willOpen);
            this.chatOpen = willOpen;
            const input = document.getElementById('chat-input');
            if (willOpen) {
                if (!IS_TOUCH) document.exitPointerLock();
                setTimeout(() => { if (input) input.focus(); }, 30);
            } else if (!IS_TOUCH && this.gameActive) {
                document.body.requestPointerLock();
            }
        }

        sendChat() {
            const input = document.getElementById('chat-input');
            if (!input) return;
            const text = input.value.trim();
            if (!text) return;
            input.value = '';
            const name = this.net.playerName || 'EXPLORADOR';
            this.appendChat(name, text);
            this.net.publishChat(text);
        }

        appendChat(name, text) {
            const box = document.getElementById('chat-messages');
            if (!box) return;
            const el = document.createElement('div');
            el.className = 'chat-msg';
            const n = document.createElement('span');
            n.className = 'chat-name';
            n.textContent = String(name).slice(0, 14) + ': ';
            el.appendChild(n);
            el.appendChild(document.createTextNode(String(text).slice(0, 200)));
            box.appendChild(el);
            while (box.children.length > 60) box.removeChild(box.firstChild);
            box.scrollTop = box.scrollHeight;
            // Con el chat cerrado, los mensajes ajenos llegan como aviso breve
            if (!this.chatOpen && name !== this.net.playerName) {
                this.notify('💬 ' + name + ': ' + String(text).slice(0, 60));
            }
        }

        checkInteractionsPrompt() {
            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
            const hits = raycaster.intersectObjects(this.scene.children, true);
            const prompt = document.getElementById('interact-prompt');
            const reticle = document.getElementById('reticle');

            let found = false;
            for (let hit of hits) {
                if (hit.distance < 2.5) {
                    // Cajones cerrados de las mesas
                    for (const b of this.furnitureBodies) {
                        const ud = b.mesh.userData;
                        if (!ud || !ud.drawer || ud.drawer.open) continue;
                        if (b.mesh === hit.object || b.mesh.children.includes(hit.object)) {
                            found = true;
                            prompt.textContent = '[E] ABRIR CAJÓN';
                            break;
                        }
                    }
                    if (found) break;
                    for (let p of this.worldSystem.pickups) {
                        if (!p.collected && (p.mesh === hit.object || p.mesh.children.includes(hit.object))) {
                            found = true;
                            if (p.type === 'camera') prompt.textContent = '[E] RECOGER CÁMARA ANALÓGICA';
                            else if (p.type === 'chalk') prompt.textContent = `[E] RECOGER TIZA [${p.colorName}]`;
                            else if (p.type === 'almond') prompt.textContent = '[E] RECOGER AGUA DE ALMENDRAS';
                            else if (p.type === 'battery') prompt.textContent = '[E] COGER PILA';
                            else if (p.type === 'note') prompt.textContent = p.wall ? '[E] LEER NOTA DE LA PARED' : '[E] LEER NOTA DEL SUELO';
                            break;
                        }
                    }
                    if (found) break;
                    // Puerta de metal de sala de seguridad (con su pila) y
                    // monitores de camaras ([E] cambia la camara)
                    for (const r of this.worldSystem.securityRooms) {
                        if (!r.doorModel) continue;
                        let o = hit.object;
                        let hitDoor = false;
                        let hitMon = false;
                        while (o) {
                            if (o === r.doorModel || o === r.panelGroup) { hitDoor = true; break; }
                            if (r.monitors && r.monitors.includes(o)) { hitMon = true; break; }
                            o = o.parent;
                        }
                        if (hitMon) {
                            found = true;
                            prompt.textContent = '[E] CAMBIAR CÁMARA';
                            break;
                        }
                        if (!hitDoor) continue;
                        found = true;
                        const b = Math.round(r.state.battery);
                        if (r.state.battery <= 0) {
                            prompt.textContent = this.inventory.batteries > 0
                                ? '⚡ SIN PILA · [E] RECARGAR (1 DE TUS PILAS)'
                                : '⚡ SIN PILA · BUSCA PILAS DE REPUESTO';
                        } else {
                            prompt.textContent = r.state.doorOpen
                                ? `[E] CERRAR PUERTA · PILA ${b}%`
                                : `[E] ABRIR PUERTA · PILA ${b}%`;
                        }
                        break;
                    }
                }
            }

            prompt.style.display = found ? 'block' : 'none';
            reticle.classList.toggle('active', found);
        }

        updatePhysics(dt) {
            const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
            const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
            const moveDir = new THREE.Vector3();

            if (this.keys['KeyW']) moveDir.add(forward);
            if (this.keys['KeyS']) moveDir.sub(forward);
            if (this.keys['KeyD']) moveDir.add(right);
            if (this.keys['KeyA']) moveDir.sub(right);
            // Joystick tactil (movil): x = lateral, y = adelante/atras
            if (this.touchMove.x !== 0 || this.touchMove.y !== 0) {
                moveDir.addScaledVector(right, this.touchMove.x);
                moveDir.addScaledVector(forward, this.touchMove.y);
            }

            const isMoving = moveDir.lengthSq() > 0;
            if (isMoving) moveDir.normalize();

            const isSprinting = this.keys['ShiftLeft'] && this.player.stamina > 5 && isMoving;
            if (isSprinting) {
                this.player.stamina = Math.max(0, this.player.stamina - 22 * dt);
            } else {
                this.player.stamina = Math.min(100, this.player.stamina + 14 * dt);
            }

            const speed = isSprinting ? this.player.speedSprint : this.player.speedWalk;
            const deltaX = moveDir.x * speed * dt;
            const deltaZ = moveDir.z * speed * dt;

            let newX = this.player.pos.x + deltaX;
            let newZ = this.player.pos.z + deltaZ;
            const r = this.player.radius;

            const slabBoxSet = this.worldSystem.slantedBoxSet;
            for (let box of this.worldSystem.wallBoxes) {
                // Cajas-segmento de los tabiques inclinados: se saltan, la
                // colision exacta con el rectangulo rotado (mas abajo) las
                // sustituye. Sin esto la escalera de cuadrados paraba al
                // jugador a ~0,8 m de la cara real de la pared diagonal.
                if (slabBoxSet && slabBoxSet.has(box)) continue;
                if (newX + r > box.minX && newX - r < box.maxX && this.player.pos.z + r > box.minZ && this.player.pos.z - r < box.maxZ) {
                    newX = deltaX > 0 ? box.minX - r : box.maxX + r;
                }
                if (this.player.pos.x + r > box.minX && this.player.pos.x - r < box.maxX && newZ + r > box.minZ && newZ - r < box.maxZ) {
                    newZ = deltaZ > 0 ? box.minZ - r : box.maxZ + r;
                }
            }

            // Tabiques inclinados: colision EXACTA contra el rectangulo
            // rotado (circulo del jugador vs rectangulo inflado por su
            // radio). Las cajas AABB por segmentos de arriba son solo una
            // caja conservadora; esta pasada empuja contra la cara REAL de
            // la pared en diagonal. Antes el jugador chocaba contra la
            // escalera de cuadrados de la colision: se quedaba a ~0,4 m de
            // la cara visible y la pared parecia mal colocada.
            const slabs = this.worldSystem.slantedSlabs;
            const resolveSlabs = (x, z) => {
                if (!slabs || !slabs.length) return [x, z];
                for (const s of slabs) {
                    const cos = Math.cos(s.ang), sin = Math.sin(s.ang);
                    const dx = x - s.cx, dz = z - s.cz;
                    const lx = dx * cos - dz * sin;
                    const lz = dx * sin + dz * cos;
                    const T = Math.max(s.T0, s.T1);
                    const cx2 = Math.max(-T / 2, Math.min(T / 2, lx));
                    const cz2 = Math.max(-s.L / 2, Math.min(s.L / 2, lz));
                    let ddx = lx - cx2, ddz = lz - cz2;
                    const d = Math.hypot(ddx, ddz);
                    if (d < r) {
                        let nlx, nlz;
                        if (d < 1e-6) {
                            // Centro dentro del tabique: salir por el eje de
                            // menor penetracion, hasta el radio fuera de la
                            // cara mas cercana
                            const penX = T / 2 - Math.abs(lx);
                            const penZ = s.L / 2 - Math.abs(lz);
                            if (penX < penZ) {
                                const dir = lx >= 0 ? 1 : -1;
                                nlx = dir * (T / 2 + r); nlz = lz;
                            } else {
                                const dir = lz >= 0 ? 1 : -1;
                                nlx = lx; nlz = dir * (s.L / 2 + r);
                            }
                        } else {
                            // Fuera del tabique: empujar desde el punto mas
                            // cercano del rectangulo ALEJANDOSE de el (antes
                            // la resta empujaba hacia la pared y el jugador
                            // la atravesaba)
                            ddx /= d; ddz /= d;
                            nlx = cx2 + ddx * r;
                            nlz = cz2 + ddz * r;
                        }
                        x = s.cx + nlx * cos + nlz * sin;
                        z = s.cz - nlx * sin + nlz * cos;
                    }
                }
                return [x, z];
            };
            [newX, newZ] = resolveSlabs(newX, newZ);

            // Muebles empujables: el jugador los desplaza en su direccion de
            // avance. La resolucion se hace por el LADO de la caja en el que
            // esta el jugador, NUNCA por el signo del movimiento: antes, al
            // tocar una silla/mesa moviendote solo en un eje (o con el mueble
            // deslizandose hacia ti), el jugador saltaba al lado contrario
            // del mueble ("me teletransporta al empujar") y podia acabar
            // dentro de una pared.
            for (const b of this.furnitureBodies) {
                if (!b.aabb) continue;
                const box = b.aabb;
                const boxCX = (box.minX + box.maxX) / 2;
                const boxCZ = (box.minZ + box.maxZ) / 2;
                const prevInBoxX = this.player.pos.x + r > box.minX && this.player.pos.x - r < box.maxX;
                const prevInBoxZ = this.player.pos.z + r > box.minZ && this.player.pos.z - r < box.maxZ;
                const overlapX = newX + r > box.minX && newX - r < box.maxX && this.player.pos.z + r > box.minZ && this.player.pos.z - r < box.maxZ;
                const overlapZ = this.player.pos.x + r > box.minX && this.player.pos.x - r < box.maxX && newZ + r > box.minZ && newZ - r < box.maxZ;
                if (overlapX) {
                    if (prevInBoxX) {
                        // El mueble se deslizo hacia el jugador (lo empuja
                        // otro, o reboto en un muro): salir por la cara mas
                        // proxima, sin saltos de lado
                        const penL = newX + r - box.minX;
                        const penR = box.maxX - (newX - r);
                        newX = penL < penR ? box.minX - r : box.maxX + r;
                    } else {
                        // El jugador cruza una cara: quedarse en el lado del
                        // que viene
                        newX = this.player.pos.x < boxCX ? box.minX - r : box.maxX + r;
                    }
                    if (!prevInBoxX && deltaX !== 0 && ((this.player.pos.x < boxCX) === (deltaX > 0))) {
                        b.vel.x += deltaX * 16;
                    }
                }
                if (overlapZ) {
                    if (prevInBoxZ) {
                        const penB = newZ + r - box.minZ;
                        const penF = box.maxZ - (newZ - r);
                        newZ = penB < penF ? box.minZ - r : box.maxZ + r;
                    } else {
                        newZ = this.player.pos.z < boxCZ ? box.minZ - r : box.maxZ + r;
                    }
                    if (!prevInBoxZ && deltaZ !== 0 && ((this.player.pos.z < boxCZ) === (deltaZ > 0))) {
                        b.vel.z += deltaZ * 16;
                    }
                }
                const sp = Math.hypot(b.vel.x, b.vel.z);
                if (sp > 3.2) { b.vel.x *= 3.2 / sp; b.vel.z *= 3.2 / sp; }
            }

            // Pasada final contra muros y tabiques: la posicion resuelta
            // contra un mueble no debe quedar dentro de una pared (antes,
            // al empujar una mesa contra un muro, el jugador entraba en la
            // pared por el empuje del mueble: "noclip al empujar").
            for (let box of this.worldSystem.wallBoxes) {
                if (slabBoxSet && slabBoxSet.has(box)) continue;
                if (newX + r > box.minX && newX - r < box.maxX && newZ + r > box.minZ && newZ - r < box.maxZ) {
                    const penX = Math.min(newX + r - box.minX, box.maxX - (newX - r));
                    const penZ = Math.min(newZ + r - box.minZ, box.maxZ - (newZ - r));
                    if (penX < penZ) {
                        newX = (newX + r - box.minX < box.maxX - (newX - r)) ? box.minX - r : box.maxX + r;
                    } else {
                        newZ = (newZ + r - box.minZ < box.maxZ - (newZ - r)) ? box.minZ - r : box.maxZ + r;
                    }
                }
            }
            [newX, newZ] = resolveSlabs(newX, newZ);

            this.player.pos.x = newX;
            this.player.pos.z = newZ;

            if (isMoving) {
                this.player.bobTimer += dt * (isSprinting ? 12 : 8);
                this.camera.position.y = 1.55 + Math.sin(this.player.bobTimer) * 0.03;

                this.player.stepTimer += dt * (isSprinting ? 1.6 : 1.0);
                if (this.player.stepTimer > 0.48) {
                    this.player.stepTimer = 0;
                    audio.playFootstep();
                }
            } else {
                this.camera.position.y = 1.55;
            }

            this.player.sanity -= 0.12 * dt;
            // En una sala de seguridad con la puerta CERRADA la entidad no
            // puede verte: nada de drenaje (ni siquiera el del espectro sync)
            if (!this.inSecurityRoomClosed()) {
                // La cordura drena de verdad SOLO mientras la entidad te VE
                // y esta cerca (o muy cerca aunque no te vea). Antes bastaba
                // con que el estado fuese CHASING: al perderle la pista
                // seguia drenando a 4/s hasta llegar a tu ultima posicion
                // ("al alejarme y perderlo, mi cordura sigue bajando rapido,
                // da igual lo que haga").
                const ent = this.entity;
                if (ent.active) {
                    const d = Math.hypot(ent.pos.x - this.player.pos.x, ent.pos.z - this.player.pos.z);
                    if (ent.state === 'CHASING' && ent.seesPlayer && d < 25) {
                        this.player.sanity -= 4.0 * dt;
                    } else if (ent.state === 'CHASING' && d < 10) {
                        this.player.sanity -= 1.0 * dt;
                    } else if (ent.state === 'SEARCHING' && d < 10) {
                        this.player.sanity -= 0.6 * dt;
                    }
                }
                // En multijugador el espectro sincronizado tambien drena
                // cordura, pero solo con linea de vision despejada: antes
                // bastaba con estar a menos de 14 m (a traves de los muros)
                if (this.net.entityActive && this.net.entityGhost && Date.now() - this.net.entityLastMsg < 3000) {
                    const g = this.net.entityGhost.position;
                    const d = Math.hypot(g.x - this.player.pos.x, g.z - this.player.pos.z);
                    if (d < 14 && this.net.hasLOS(g.x, g.z, this.player.pos.x, this.player.pos.z, this.worldSystem.wallBoxes)) {
                        this.player.sanity -= 3.0 * dt;
                    }
                }
            }
            this.updateSanityHUD();

            if (this.player.sanity <= 0) {
                this.triggerGameOver("TU MENTE SUCUMBIÓ ANTE LA PENUMBRA");
            }
        }

        triggerGameOver(reason) {
            this.gameActive = false;
            document.exitPointerLock();
            this.toggleChat(false);
            document.getElementById('hud').style.display = 'none';
            document.getElementById('game-over-reason').textContent = reason;
            document.getElementById('game-over-screen').style.display = 'flex';
            this.net.leave();
        }

        // ---- SALAS DE SEGURIDAD (FNAF) ---------------------------------
        findSecurityRoomById(id) {
            for (const r of this.worldSystem.securityRooms) {
                if (r.id === id) return r;
            }
            return null;
        }

        // El jugador esta DENTRO de una sala de seguridad con la puerta cerrada
        inSecurityRoomClosed() {
            for (const r of this.worldSystem.securityRooms) {
                if (r.state.doorOpen) continue;
                const px = this.player.pos.x, pz = this.player.pos.z;
                if (px > r.minX - 0.6 && px < r.maxX + 0.6 && pz > r.minZ - 0.6 && pz < r.maxZ + 0.6) return true;
            }
            return false;
        }

        // Pila de la puerta, animacion de subida/bajada, panel y monitor
        updateSecurityRooms(dt) {
            for (const r of this.worldSystem.securityRooms) {
                // Estado de la puerta compartido por red: se aplica la primera
                // vez que se carga la sala (si otro jugador la cerro antes)
                if (!r._synced) {
                    r._synced = true;
                    if (this.doorStates.has(r.id)) {
                        r.state.doorOpen = this.doorStates.get(r.id);
                    }
                }
                // La pila se gasta SOLO con la puerta cerrada (como FNAF); si
                // se agota, corte de energia: la puerta se abre sola
                if (!r.state.doorOpen) {
                    r.state.battery = Math.max(0, r.state.battery - dt * 0.7);
                    if (r.state.battery <= 0) {
                        r.state.doorOpen = true;
                        this.doorStates.set(r.id, true);
                        this.net.publishDoor(r.id, true);
                        if (Math.hypot(r.centerX - this.player.pos.x, r.centerZ - this.player.pos.z) < 22) {
                            this.notify('⚡ CORTE DE ENERGÍA · LA PUERTA SE ABRIÓ');
                        }
                        this.worldSystem.rebuildUnions();
                    }
                }
                // La puerta sube al techo al abrirse y baja al cerrarse. El
                // techo esta a 2,7 m y los paneles miden 2,24 m: el tope es
                // 2,72 para que el canto inferior quede JUSTO oculto tras el
                // plano del techo. Antes se paraba en 2,42 y quedaba un
                // trozo de puerta colgando del techo ("la puerta
                // entreabierta atravesando la pared").
                if (r.doorGroup) {
                    const target = r.state.doorOpen ? 2.72 : 0;
                    r.doorGroup.position.y += (target - r.doorGroup.position.y) * Math.min(1, dt * 6);
                }
                // Pantalla de pila del panel de control (solo si estas cerca)
                if (r.panelCanvas && Math.hypot(r.centerX - this.player.pos.x, r.centerZ - this.player.pos.z) < 22) {
                    this._panelTimer += dt;
                    if (this._panelTimer > 0.3) {
                        this._panelTimer = 0;
                        const x = r.panelCanvas.getContext('2d');
                        x.clearRect(0, 0, 96, 48);
                        x.fillStyle = '#0a1408';
                        x.fillRect(0, 0, 96, 48);
                        const b = Math.round(r.state.battery);
                        x.fillStyle = b > 20 ? '#9be34a' : (b > 0 ? '#e3c34a' : '#e34a3a');
                        x.font = 'bold 15px Courier New';
                        x.textAlign = 'center';
                        x.fillText('PILA ' + b + '%', 48, 29);
                        r.panelTex.needsUpdate = true;
                    }
                }
            }
        }

        // Las camaras de pared vigilan al jugador: giran la cabeza hacia el
        // y encienden el LED rojo cuando esta en su radio
        updateCameras(dt) {
            for (const cam of this.worldSystem.cameras) {
                const dx = this.player.pos.x - cam.x;
                const dz = this.player.pos.z - cam.z;
                const dist = Math.hypot(dx, dz);
                const watching = dist < 24;
                cam.group.userData.ledMat.emissiveIntensity = watching ? 2.5 : 0;
                if (!watching) continue;
                // Direccion del jugador en el sistema local de la camara.
                // CORREGIDO: antes se usaba Math.cos(-baseRy)/Math.sin(-baseRy)
                // y las camaras de las paredes E/O giraban la cabeza HACIA EL
                // LADO CONTRARIO al jugador ("hay camaras que ven al lado
                // contrario a donde estoy": la cabeza apuntaba a la pared y
                // el jugador de delante quedaba detras de su vision). La
                // transformacion mundo->local de un objeto con giro ry es
                // R(-ry), que se calcula con cos(ry) y -sin(ry):
                const cos = Math.cos(cam.baseRy), sin = Math.sin(cam.baseRy);
                const lx = dx * cos - dz * sin;
                const lz = dx * sin + dz * cos;
                const target = Math.max(-1.3, Math.min(1.3, Math.atan2(lx, lz)));
                const head = cam.group.userData.head;
                let y = head.rotation.y;
                let diff = target - y;
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;
                head.rotation.y += diff * Math.min(1, dt * 3);
            }
        }

        // Monitores de las salas de seguridad (FNAF): UNO POR PARED, cada
        // uno con su camara DISTINTA (las mas cercanas a la sala, sin
        // repetir) y su propio render target. La camara del feed BARRE de
        // lado a lado con fase propia por monitor, y [E] sobre un monitor
        // cambia su camara a la siguiente. Solo retransmiten las salas
        // cercanas al jugador (las pantallas lejanas no se ven).
        updateCameraFeeds(dt) {
            if (!this._noSignalTex) {
                const c = document.createElement('canvas');
                c.width = 320; c.height = 240;
                const x = c.getContext('2d');
                x.fillStyle = '#0a0d12';
                x.fillRect(0, 0, 320, 240);
                x.fillStyle = '#3a4a3a';
                x.font = 'bold 18px Courier New';
                x.textAlign = 'center';
                x.fillText('SIN SEÑAL', 160, 122);
                this._noSignalTex = new THREE.CanvasTexture(c);
            }
            this._feedTime += dt;
            const cams = this.worldSystem.cameras;
            const px = this.player.pos.x, pz = this.player.pos.z;
            for (const r of this.worldSystem.securityRooms) {
                if (!r.monitors || !r.monitors.length || !r.doorModel) continue;
                if (Math.hypot(r.centerX - px, r.centerZ - pz) > 32) continue;
                r._monPicks = r._monPicks || [0, 1, 2];
                // Camaras ordenadas por cercania a la SALA (no al jugador):
                // la asignacion es estable mientras el jugador no se mueve
                const near = cams.slice().sort((a, b) =>
                    Math.hypot(a.x - r.centerX, a.z - r.centerZ) -
                    Math.hypot(b.x - r.centerX, b.z - r.centerZ));
                for (let i = 0; i < r.monitors.length; i++) {
                    const mon = r.monitors[i];
                    const pick = r._monPicks[i];
                    const key = r.id + ':' + i;
                    let feed = this._monFeeds.get(key);
                    if (!feed) {
                        feed = {
                            rt: new THREE.WebGLRenderTarget(256, 192),
                            cam: new THREE.PerspectiveCamera(60, 256 / 192, 0.1, 80),
                            timer: i * 0.2,
                            lastPick: -1,
                            // Vision nocturna verde (FNAF): el feed en crudo
                            // salia casi negro (los pasillos estan oscuros) y
                            // en la pantalla no se leia nada. Se lee el
                            // render target y se remapea a tonos verdes con
                            // contraste subido.
                            canvas: document.createElement('canvas'),
                            ctx: null,
                            buf: null,
                            img: null,
                            tex: null
                        };
                        feed.canvas.width = 256;
                        feed.canvas.height = 192;
                        feed.ctx = feed.canvas.getContext('2d');
                        feed.img = feed.ctx.createImageData(256, 192);
                        feed.buf = new Uint8Array(256 * 192 * 4);
                        feed.tex = new THREE.CanvasTexture(feed.canvas);
                        feed.tex.minFilter = THREE.LinearFilter;
                        this._monFeeds.set(key, feed);
                    }
                    // Etiqueta CAM xx de la placa del monitor
                    if (feed.lastPick !== pick) {
                        feed.lastPick = pick;
                        const lx = mon.userData.labelCtx;
                        if (lx) {
                            lx.clearRect(0, 0, 128, 28);
                            lx.fillStyle = '#0a0d12';
                            lx.fillRect(0, 0, 128, 28);
                            lx.fillStyle = '#9be34a';
                            lx.font = 'bold 15px Courier New';
                            lx.textAlign = 'center';
                            lx.fillText('CAM ' + String(pick + 1).padStart(2, '0'), 64, 19);
                            mon.userData.labelTex.needsUpdate = true;
                        }
                    }
                    const mat = mon.userData.screenMat;
                    if (r.state.battery <= 0 || pick >= near.length) {
                        mat.map = this._noSignalTex;
                        mat.needsUpdate = true;
                        continue;
                    }
                    feed.timer += dt;
                    if (feed.timer < 0.55) {
                        mat.map = feed.tex || feed.rt.texture;
                        mat.needsUpdate = true;
                        continue;
                    }
                    feed.timer = 0;
                    const camObj = near[pick];
                    camObj.group.updateMatrixWorld(true);
                    const pos = new THREE.Vector3();
                    camObj.group.getWorldPosition(pos);
                    const q = new THREE.Quaternion();
                    camObj.group.userData.head.getWorldQuaternion(q);
                    const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
                    // Barrido lateral: la camara del feed se mueve de lado a
                    // lado con su propia fase por monitor (FNAF: las camaras
                    // vigilan barriendo el pasillo)
                    const pan = Math.sin(this._feedTime * 0.45 + i * 2.1) * 0.65;
                    const baseYaw = Math.atan2(dir.x, dir.z);
                    const yaw = baseYaw + pan;
                    const cam = feed.cam;
                    cam.position.copy(pos);
                    cam.lookAt(new THREE.Vector3(
                        pos.x + Math.sin(yaw) * 12,
                        Math.max(0.5, pos.y - 0.6),
                        pos.z + Math.cos(yaw) * 12));
                    // Evitar el bucle de realimentacion de GL: el monitor usa
                    // como textura el propio render target y, si la camara de
                    // seguridad lo ve mientras se renderiza el feed, WebGL
                    // descarta el frame (GL_INVALID_OPERATION) y la pantalla
                    // puede quedarse negra.
                    const hidden = [];
                    for (const r2 of this.worldSystem.securityRooms) {
                        for (const m of r2.monitors || []) { hidden.push(m); m.visible = false; }
                    }
                    this.renderer.setRenderTarget(feed.rt);
                    this.renderer.render(this.scene, cam);
                    this.renderer.setRenderTarget(null);
                    for (const m of hidden) m.visible = true;
                    // Tinte verde de vision nocturna + contraste (FNAF)
                    this.renderer.readRenderTargetPixels(feed.rt, 0, 0, 256, 192, feed.buf);
                    const d = feed.img.data;
                    for (let p = 0; p < d.length; p += 4) {
                        const lum = (feed.buf[p] * 0.299 + feed.buf[p + 1] * 0.587 + feed.buf[p + 2] * 0.114) | 0;
                        d[p] = (lum * 0.22) | 0;
                        d[p + 1] = Math.min(255, lum * 1.35 + 34) | 0;
                        d[p + 2] = (lum * 0.4) | 0;
                        d[p + 3] = 255;
                    }
                    feed.ctx.putImageData(feed.img, 0, 0);
                    feed.tex.needsUpdate = true;
                    mat.map = feed.tex;
                    mat.needsUpdate = true;
                }
            }
        }

        updateNetHUD() {
            const el = document.getElementById('net-status');
            if (!el) return;
            const txt = this.net.hudText();
            if (txt !== this._netHud) {
                this._netHud = txt;
                el.textContent = '🛰 ' + txt;
                el.style.color = this.net.roomFull ? '#d15b4a' : (this.net.joined ? '#8fa336' : '#756a47');
            }
        }

        onResize() {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        }

        animate() {
            requestAnimationFrame(() => this.animate());

            const dt = Math.min(this.clock.getDelta(), 0.1);

            if (this.gameActive) {
                // Boton de dibujo visible solo con la tiza equipada (movil)
                const drawBtn = document.getElementById('btn-touch-draw');
                if (drawBtn) {
                    const show = this.inventory.currentSlot === 1 && this.inventory.hasChalk && this.inventory.chalkPoints > 0;
                    if (show !== (drawBtn.style.display !== 'none')) {
                        drawBtn.style.display = show ? 'flex' : 'none';
                    }
                }
                // Mundo infinito: carga/descarga chunks alrededor del jugador
                this.worldSystem.update(this.player.pos);
                this.syncFurnitureBodies();
                this.updatePhysics(dt);
                this.updateFurniturePhysics(dt);
                this.updateLights(dt);
                this.updateCoordsHUD();
                this.updateFlashlightBattery(dt);
                // Mantener [I] pulsado recarga la linterna con las pilas de
                // repuesto almacenadas (1 pila ~ 0,9 s de recarga)
                if (this.keys['KeyI'] && this.inventory.batteries > 0 && this.inventory.flashBattery < 100) {
                    this.inventory.flashBattery = Math.min(100, this.inventory.flashBattery + dt * 110);
                    this._iRechargeAcc += dt;
                    if (this._iRechargeAcc > 0.9) {
                        this._iRechargeAcc = 0;
                        this.inventory.batteries--;
                        this.notify('🔋 PILA COLOCADA EN LA LINTERNA');
                        audio.playSwitchClick();
                    }
                    this.updateFlashlightHUD();
                }
                // Salas de seguridad: pila/animation de la puerta, camaras
                // que vigilan y monitor con el feed de camaras
                this.updateSecurityRooms(dt);
                this.updateCameras(dt);
                this.updateCameraFeeds(dt);
                this.updateChalkDrawing();
                this.checkInteractionsPrompt();
                // Mapa: marcar explorado (cada 0,3 s), repintar si esta abierto
                // y publicar los chunks nuevos a la sala (throttled)
                this._mapTick += dt;
                if (this._mapTick > 0.3) {
                    this._mapTick = 0;
                    this.markExplored();
                }
                if (this.mapOpen) {
                    this._mapRedrawTick += dt;
                    if (this._mapRedrawTick > 0.4) {
                        this._mapRedrawTick = 0;
                        this.renderMap();
                    }
                }
                if (this.mapDirty) {
                    this._mapPubTick += dt;
                    if (this._mapPubTick > 1.5) {
                        this._mapPubTick = 0;
                        this.mapDirty = false;
                        this.net.publishMap();
                    }
                }
                this.net.update(dt, this.player.pos, this.yaw, this.pitch, this.flashlightOn, this.worldSystem.wallBoxes, this.entity, this.furnitureBodies);
                this.updateNetHUD();
                this.entity.update(
                    dt,
                    this.player.pos,
                    this.player.sanity,
                    this.worldSystem.wallBoxes,
                    this.worldSystem.walkableCells,
                    (reason) => this.triggerGameOver(reason),
                    this.furnitureBodies
                );
                // Cuando la entidad aparece de verdad (o reaparece), la sala
                // se entera: los espectros se colocan en su posicion real
                if (this.entity.active && !this._entSpawnNotified) {
                    this._entSpawnNotified = true;
                    this.net.onEntitySpawned();
                }
            }

            if (Math.random() < 0.3) this.renderNoise();

            this.renderer.render(this.scene, this.camera);
        }
    }

    window.addEventListener('DOMContentLoaded', () => {
        new BackroomsGame();
    });
