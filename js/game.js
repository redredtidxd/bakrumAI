/* ==========================================================================
       7. CONTROLADOR PRINCIPAL, ILUMINACIÓN Y NIEBLA AMARILLENTA CONTINUA
       ========================================================================== */
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
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
            this.renderer.setClearColor(FOG_COLOR);
            // Control de exposición: mapeado de tonos oscuro y aterrador
            this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
            this.renderer.toneMappingExposure = 0.58;
            this.container.appendChild(this.renderer.domElement);

            // Anisotropía: paredes y moqueta se ven nítidas incluso en ángulo rasante
            const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
            [Materials.floor.map, Materials.wall.map, Materials.ceiling.map].forEach(t => {
                if (t) t.anisotropy = Math.min(8, maxAniso);
            });

            // Luz ambiental casi nula: paredes y moqueta en penumbra ocre
            // AMARILLENTA (el backroom fluorescente, no blanco).
            this.ambientLight = new THREE.AmbientLight(0xded187, 0.11);
            this.scene.add(this.ambientLight);

            // Relleno hemisférico mínimo para evitar el aspecto lavado
            this.hemiLight = new THREE.HemisphereLight(0xfff3c0, 0x6a5d30, 0.10);
            this.scene.add(this.hemiLight);

            this.flashlightOn = true;
            // Linterna mejorada: mas alcance, tono calido amarillento y un cono
            // algo mas cerrado con borde suave (penumbra alta)
            this.flashlight = new THREE.SpotLight(0xfff0b0, 2.0, 36, Math.PI / 6, 0.95, 2.0);
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
            // pasillo quedaba negro hasta pisar cada foco. Ahora 28 focos con
            // radio 16 m, repartidos con prioridad a las lamparas VISIBLES en
            // pantalla: toda lampara a la vista tiene su luz.
            this.lightPool = [];
            for (let i = 0; i < 28; i++) {
                const pl = new THREE.PointLight(0xffd878, 0, 16, 2.0);
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
            this.updateSeedLabel();

            this.worldSystem = new WorldGridSystem(this.scene);
            this.chalkSystem = new ChalkDrawingSystem(this.scene, this.camera);
            this.entity = new BacteriophageEntity(this.scene);

            // Multijugador (hasta 6): mismo mundo deterministico + broker MQTT
            this.net = new MultiplayerManager(this.scene, this.camera, {
                onToast: (msg) => this.notify(msg),
                onKill: (reason) => this.triggerGameOver(reason)
            });
            // El mundo y la tiza se sincronizan por red: objetos reclamados y
            // dibujos visibles para toda la sala
            this.net.worldSync = this.worldSystem;
            this.net.onChalkDot = (pt, n, c) => this.chalkSystem.addDot(pt, n, c);

            window.addEventListener('beforeunload', () => this.net.leave());
            window.addEventListener('pagehide', () => this.net.leave());

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

            this.initInput();
            this.initNoiseCanvas();
            this.initUI();
            const notesLabel = document.getElementById('notes-count-label');
            if (notesLabel) notesLabel.textContent = `0 / ${this.inventory.totalNotes} NOTAS`;
            this.updateFlashlightHUD();

            setTimeout(() => {
                // Solo el ANFITRIÓN de la sala (o el jugador solitario) genera
                // la entidad; el resto la ve como espectro sincronizado
                if (this.gameActive && this.net.isEntityHost()) {
                    this.entity.spawnDistant(this.worldSystem.walkableCells, this.player.pos);
                    this.net.onEntitySpawned();
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
            this.flashlight.intensity = this.flashlightOn ? 2.0 : 0;
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
                    this.flashlight.intensity = 1.1 + Math.random() * 1.0;
                    if (Math.random() < 0.06) audio.flickerHum();
                } else {
                    this.flashlight.intensity = 2.0;
                }
            }
            this.updateFlashlightHUD();
        }

        updateFlashlightHUD() {
            const pct = Math.max(0, Math.round(this.inventory.flashBattery));
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
                lab.textContent = `${pct}%` + (this.inventory.batteries > 0 ? ` +${this.inventory.batteries}` : '');
                lab.style.color = pct <= 0 ? '#d15b4a' : '#b7a97c';
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
                if (this.gameActive && !this.isLocked) {
                    document.body.requestPointerLock();
                }
            });

            document.addEventListener('pointerlockchange', () => {
                this.isLocked = document.pointerLockElement === document.body;
            });
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
            if (el) el.textContent = 'SEMILLA: ' + this.worldSeed;
        }

        initUI() {
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
                // siempre); los textos se convierten con un hash estable.
                const seedInput = document.getElementById('seed-input');
                const seedText = seedInput ? seedInput.value.trim() : '';
                if (seedText) {
                    const seed = /^\d+$/.test(seedText) ? (parseInt(seedText, 10) >>> 0) : stringSeed(seedText);
                    if (seed !== this.worldSeed) {
                        this.worldSeed = seed;
                        this.worldSystem.rebuild(seed);
                        this.setupRandomSpawn();
                        // Los cuerpos fisicos apuntaban a muebles del mundo viejo
                        this.furnitureBodies = [];
                        this.syncFurnitureBodies();
                        this.updateSeedLabel();
                    }
                }

                // Multijugador: la SEMILLA es el codigo de sala. Quienes usen
                // la misma semilla (o el mismo numero mostrado en el HUD)
                // caen en el mismo backroom, hasta 6 exploradores.
                const nameInput = document.getElementById('name-input');
                const name = nameInput ? nameInput.value.trim() : '';
                if (name) {
                    try { localStorage.setItem('backrooms-name', name); } catch (e) { /* noop */ }
                }
                this.net.join(this.worldSeed, name);

                document.getElementById('start-menu').style.display = 'none';
                document.getElementById('hud').style.display = 'flex';
                this.gameActive = true;
                document.body.requestPointerLock();
            };

            document.getElementById('btn-close-notebook').onclick = () => this.toggleNotebook();

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
                    for (let p of this.worldSystem.pickups) {
                        if (!p.collected && (p.mesh === hit.object || p.mesh.children.includes(hit.object))) {
                            p.collected = true;
                            this.scene.remove(p.mesh);
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
            document.getElementById('notes-count-label').textContent = `${this.inventory.notesCollected} / ${this.inventory.totalNotes} NOTAS`;

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
            if (!isOpen) document.exitPointerLock();
            else document.body.requestPointerLock();
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
                if (hit.distance < 2.7 && hit.object.material && (hit.object.material === Materials.wall || hit.object.material === Materials.floor)) {
                    if (!this.chalkSystem.lastDrawPoint || this.chalkSystem.lastDrawPoint.distanceTo(hit.point) > 0.05) {
                        this.chalkSystem.addDot(hit.point, hit.face.normal, this.inventory.chalkColor);
                        // Los dibujos de tiza se comparten con toda la sala
                        this.net.queueChalkDot(hit.point, hit.face.normal, this.inventory.chalkColor);
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
                if (sorted[i] && sorted[i].dist < 21) {
                    const l = sorted[i].lamp;
                    light.position.copy(l.pos);

                    if (l.state === 1) {
                        // Paneles encendidos: luz continua, visible de lejos
                        light.intensity = 0.68;
                    } else if (l.state === 2) {
                        l.flickerTimer -= dt;
                        if (l.flickerTimer <= 0) {
                            l.isLitNow = Math.random() < 0.75;
                            l.flickerTimer = Math.random() * 0.25 + 0.05;
                            if (!l.isLitNow && Math.random() < 0.15) audio.flickerHum();
                        }
                        light.intensity = l.isLitNow ? (0.72 + Math.random() * 0.2) : 0.06;
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
                baseRot: new THREE.Euler(mesh.rotation.x, mesh.rotation.y, mesh.rotation.z)
            };
            // Asentado sobre el suelo desde el principio: nunca flota ni levita
            mesh.visible = true;
            mesh.position.set(x, 0, z);
            snapToFloor(mesh, 0);
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

        checkInteractionsPrompt() {
            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
            const hits = raycaster.intersectObjects(this.scene.children, true);
            const prompt = document.getElementById('interact-prompt');
            const reticle = document.getElementById('reticle');

            let found = false;
            for (let hit of hits) {
                if (hit.distance < 2.5) {
                    for (let p of this.worldSystem.pickups) {
                        if (!p.collected && (p.mesh === hit.object || p.mesh.children.includes(hit.object))) {
                            found = true;
                            if (p.type === 'camera') prompt.textContent = '[E] RECOGER CÁMARA ANALÓGICA';
                            else if (p.type === 'chalk') prompt.textContent = `[E] RECOGER TIZA [${p.colorName}]`;
                            else if (p.type === 'almond') prompt.textContent = '[E] RECOGER AGUA DE ALMENDRAS';
                            else if (p.type === 'battery') prompt.textContent = '[E] COGER PILA';
                            else if (p.type === 'note') prompt.textContent = '[E] LEER NOTA DEL SUELO';
                            break;
                        }
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

            for (let box of this.worldSystem.wallBoxes) {
                if (newX + r > box.minX && newX - r < box.maxX && this.player.pos.z + r > box.minZ && this.player.pos.z - r < box.maxZ) {
                    newX = deltaX > 0 ? box.minX - r : box.maxX + r;
                }
                if (this.player.pos.x + r > box.minX && this.player.pos.x - r < box.maxX && newZ + r > box.minZ && newZ - r < box.maxZ) {
                    newZ = deltaZ > 0 ? box.minZ - r : box.maxZ + r;
                }
            }

            // Muebles empujables: el jugador los desplaza en su dirección de avance
            for (const b of this.furnitureBodies) {
                if (!b.aabb) continue;
                const box = b.aabb;
                if (newX + r > box.minX && newX - r < box.maxX && this.player.pos.z + r > box.minZ && this.player.pos.z - r < box.maxZ) {
                    newX = deltaX > 0 ? box.minX - r : box.maxX + r;
                    if (deltaX !== 0) b.vel.x += deltaX * 16;
                }
                if (this.player.pos.x + r > box.minX && this.player.pos.x - r < box.maxX && newZ + r > box.minZ && newZ - r < box.maxZ) {
                    newZ = deltaZ > 0 ? box.minZ - r : box.maxZ + r;
                    if (deltaZ !== 0) b.vel.z += deltaZ * 16;
                }
                const sp = Math.hypot(b.vel.x, b.vel.z);
                if (sp > 3.2) { b.vel.x *= 3.2 / sp; b.vel.z *= 3.2 / sp; }
            }

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
            if (this.entity.active && this.entity.state === 'CHASING') {
                this.player.sanity -= 4.0 * dt;
            } else if (this.net.entityNear(this.player.pos, 14)) {
                // En multijugador el espectro sincronizado tambien drena cordura
                this.player.sanity -= 3.0 * dt;
            }
            this.updateSanityHUD();

            if (this.player.sanity <= 0) {
                this.triggerGameOver("TU MENTE SUCUMBIÓ ANTE LA PENUMBRA");
            }
        }

        triggerGameOver(reason) {
            this.gameActive = false;
            document.exitPointerLock();
            document.getElementById('hud').style.display = 'none';
            document.getElementById('game-over-reason').textContent = reason;
            document.getElementById('game-over-screen').style.display = 'flex';
            this.net.leave();
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
                // Mundo infinito: carga/descarga chunks alrededor del jugador
                this.worldSystem.update(this.player.pos);
                this.syncFurnitureBodies();
                this.updatePhysics(dt);
                this.updateFurniturePhysics(dt);
                this.updateLights(dt);
                this.updateCoordsHUD();
                this.updateFlashlightBattery(dt);
                this.updateChalkDrawing();
                this.checkInteractionsPrompt();
                this.net.update(dt, this.player.pos, this.yaw, this.pitch, this.flashlightOn, this.worldSystem.wallBoxes, this.entity);
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
            }

            if (Math.random() < 0.3) this.renderNoise();

            this.renderer.render(this.scene, this.camera);
        }
    }

    window.addEventListener('DOMContentLoaded', () => {
        new BackroomsGame();
    });
