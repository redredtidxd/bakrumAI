/* ==========================================================================
       6. INTELIGENCIA ARTIFICIAL DEL MONSTRUO: PATRULLA, FOV Y SIGILO
       ========================================================================== */
    // Construye el modelo 3D de la entidad (cuerpo de tentaculos negros).
    // Se usa tanto para la entidad local como para el ESPECTRO sincronizado
    // que ven los demas jugadores en multijugador.
    function createEntityModel() {
        const group = new THREE.Group();
        const tentacles = [];
        const blackMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.1, metalness: 0.95 });

        for (let i = 0; i < 6; i++) {
            const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 0.35, 6), blackMat);
            seg.position.y = 0.2 + i * 0.28;
            group.add(seg);
            tentacles.push(seg);
        }

        const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), blackMat);
        head.position.y = 1.9;
        group.add(head);

        const redEyeMat = new THREE.MeshBasicMaterial({ color: 0xff1111 });
        const eye1 = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), redEyeMat);
        eye1.position.set(0.06, 1.93, 0.14);
        const eye2 = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), redEyeMat);
        eye2.position.set(-0.06, 1.93, 0.14);
        group.add(eye1, eye2);

        for (let i = 0; i < 4; i++) {
            const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.05, 1.4, 5), blackMat);
            arm.position.set((i % 2 === 0 ? 0.3 : -0.3), 1.2, 0);
            arm.rotation.z = (i % 2 === 0 ? 0.4 : -0.4);
            group.add(arm);
            tentacles.push(arm);
        }

        return { group, tentacles };
    }

    class BacteriophageEntity {
        constructor(scene, worldSystem) {
            this.scene = scene;
            this.worldSystem = worldSystem || null;   // para no atravesar tabiques inclinados
            this.mesh = new THREE.Group();
            this.state = 'WANDERING';
            this.speed = 1.5;
            this.pos = new THREE.Vector3(0, -999, 0);
            this.active = false;
            this.stunTimer = 0;
            this.searchTimer = 0;
            this.yaw = 0;
            this.targetWaypoint = new THREE.Vector3();
            this.lastKnownPos = new THREE.Vector3();
            this.tentacles = [];

            // IA de navegacion: camino por celdas transitables (BFS) + choque
            // con paredes por eje. La entidad NUNCA atraviesa un muro.
            this.path = [];              // waypoints {x, z} en metros (centros de celda)
            this.pathTarget = null;      // destino actual del camino
            this.pathTimer = 0;          // recalcular el camino como mucho cada X s
            this._blocked = 0;           // tiempo atascado contra un obstaculo
            this._wallBoxes = [];
            this._furniture = [];
            // Reaparicion: la primera sale a los 50 s (lo activa el anfitrion)
            // y si te alejas demasiado desaparece y vuelve mas tarde
            this.respawnTimer = 50;
            this.canRespawn = false;

            const model = createEntityModel();
            this.mesh = model.group;
            this.tentacles = model.tentacles;
            this.mesh.visible = false;
            this.scene.add(this.mesh);
        }

        spawnDistant(walkableCells, playerPos) {
            if (this.active) return;
            const valid = walkableCells.filter(c => {
                const wx = (c.x + 0.5) * CELL_SIZE;
                const wz = (c.z + 0.5) * CELL_SIZE;
                if (this.worldSystem && this.worldSystem.pointInSlab(wx, wz)) return false;
                return Math.hypot(wx - playerPos.x, wz - playerPos.z) >= 48.0;
            });

            if (valid.length === 0) return;
            const pick = valid[Math.floor(Math.random() * valid.length)];
            this.pos.set((pick.x + 0.5) * CELL_SIZE, 0, (pick.z + 0.5) * CELL_SIZE);
            this.mesh.position.copy(this.pos);
            this.mesh.visible = true;
            this.active = true;
            this.state = 'WANDERING';
            this.path = [];
            this.pathTarget = null;
            this.pickWanderTarget(walkableCells, playerPos);
            audio.playMonsterRoar();
        }

        // Elige un destino ALCANZABLE por la rejilla de celdas abiertas, con
        // sesgo hacia las cercanias del jugador (crea encuentros sin ser
        // asfixiante). Nada de waypoints a traves de las paredes.
        pickWanderTarget(walkableCells, playerPos) {
            let open = [];
            if (this.worldSystem) {
                for (const ch of this.worldSystem.chunks.values()) {
                    if (!ch.loaded) continue;
                    for (const c of ch.openCells) open.push(c);
                }
            }
            if (!open.length) open = walkableCells;
            if (!open.length) return;
            const near = open.filter(c => {
                const wx = (c.x + 0.5) * CELL_SIZE;
                const wz = (c.z + 0.5) * CELL_SIZE;
                const d = Math.hypot(wx - playerPos.x, wz - playerPos.z);
                return d > 14 && d < 55;
            });
            const pool = near.length > 10 ? near : open;
            const pick = pool[Math.floor(Math.random() * pool.length)];
            const t = new THREE.Vector3((pick.x + 0.5) * CELL_SIZE, 0, (pick.z + 0.5) * CELL_SIZE);
            this.recomputePath(t, walkableCells);
        }

        // BFS sobre las celdas abiertas de los chunks cargados: camino de
        // centros de celda hasta el destino (garantiza no cruzar muros, y
        // entre celdas contiguas abiertas nunca hay una pared fina en medio).
        // Las celdas cuyo CENTRO queda tapado por un tabique inclinado o un
        // mueble se excluyen del grafo: el camino rodea los obstaculos.
        recomputePath(targetPos, walkableCells) {
            const C = CELL_SIZE;
            const open = new Set();
            const centerBlocked = (wx, wz) => {
                if (this.worldSystem && this.worldSystem.slantedAABBs) {
                    for (const s of this.worldSystem.slantedAABBs) {
                        if (wx > s.minX && wx < s.maxX && wz > s.minZ && wz < s.maxZ) return true;
                    }
                }
                for (const b of this._furniture) {
                    if (b.aabb && wx > b.aabb.minX - 0.2 && wx < b.aabb.maxX + 0.2 &&
                        wz > b.aabb.minZ - 0.2 && wz < b.aabb.maxZ + 0.2) return true;
                }
                return false;
            };
            if (this.worldSystem) {
                for (const ch of this.worldSystem.chunks.values()) {
                    if (!ch.loaded) continue;
                    for (const c of ch.openCells) {
                        if (!centerBlocked((c.x + 0.5) * C, (c.z + 0.5) * C)) open.add(c.x + ',' + c.z);
                    }
                }
            } else {
                for (const c of walkableCells) {
                    if (!centerBlocked((c.x + 0.5) * C, (c.z + 0.5) * C)) open.add(c.x + ',' + c.z);
                }
            }
            if (!open.size) return;
            // El segmento entre dos centros de celda contiguos tambien debe
            // quedar libre: un mueble o tabique puede tapar el paso aunque
            // ningun centro caiga dentro de el.
            const segClear = (ax, az, bx, bz) => {
                const pad = 0.1;
                const boxes = [];
                if (this.worldSystem && this.worldSystem.slantedAABBs) {
                    for (const s of this.worldSystem.slantedAABBs) boxes.push(s);
                }
                for (const b of this._furniture) {
                    if (b.aabb) boxes.push(b.aabb);
                }
                for (const box of boxes) {
                    let tmin = 0, tmax = 1;
                    const dx = bx - ax, dz = bz - az;
                    const ps = [-dx, dx, -dz, dz];
                    const qs = [ax - (box.minX - pad), (box.maxX + pad) - ax, az - (box.minZ - pad), (box.maxZ + pad) - az];
                    let hit = true;
                    for (let i = 0; i < 4; i++) {
                        if (ps[i] === 0) {
                            if (qs[i] < 0) { hit = false; break; }
                        } else {
                            const r = qs[i] / ps[i];
                            if (ps[i] < 0) tmin = Math.max(tmin, r);
                            else tmax = Math.min(tmax, r);
                            if (tmin > tmax) { hit = false; break; }
                        }
                    }
                    if (hit) return false;
                }
                return true;
            };
            const sx = Math.floor(this.pos.x / C), sz = Math.floor(this.pos.z / C);
            let start = sx + ',' + sz;
            if (!open.has(start)) {
                // Dentro de un muro (raro): salir a la celda abierta mas cercana
                let best = null, bestD = Infinity;
                for (const k of open) {
                    const [kx, kz] = k.split(',').map(Number);
                    const d2 = (kx - sx) * (kx - sx) + (kz - sz) * (kz - sz);
                    if (d2 < bestD) { bestD = d2; best = k; }
                }
                if (!best) return;
                start = best;
                const [bx, bz] = best.split(',').map(Number);
                this.pos.x = (bx + 0.5) * C;
                this.pos.z = (bz + 0.5) * C;
            }
            const tx = Math.floor(targetPos.x / C), tz = Math.floor(targetPos.z / C);
            const endKey = tx + ',' + tz;
            if (!open.has(endKey)) { this.path = []; return; }
            const parent = new Map();
            parent.set(start, -1);
            const q = [start];
            let qi = 0;
            const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            const centerOf = (k) => {
                const comma = k.indexOf(',');
                return { x: (parseInt(k.slice(0, comma), 10) + 0.5) * C, z: (parseInt(k.slice(comma + 1), 10) + 0.5) * C };
            };
            let found = false;
            while (qi < q.length) {
                const k = q[qi++];
                if (k === endKey) { found = true; break; }
                const comma = k.indexOf(',');
                const kx = parseInt(k.slice(0, comma), 10);
                const kz = parseInt(k.slice(comma + 1), 10);
                const a = centerOf(k);
                for (const [dx, dz] of dirs) {
                    const nk = (kx + dx) + ',' + (kz + dz);
                    if (open.has(nk) && !parent.has(nk)) {
                        const b = centerOf(nk);
                        if (!segClear(a.x, a.z, b.x, b.z)) continue;
                        parent.set(nk, k);
                        q.push(nk);
                    }
                }
            }
            if (!found) { this.path = []; return; }
            const path = [];
            let k = endKey;
            while (k !== start && k !== -1) {
                const comma = k.indexOf(',');
                const kx = parseInt(k.slice(0, comma), 10);
                const kz = parseInt(k.slice(comma + 1), 10);
                path.push({ x: (kx + 0.5) * C, z: (kz + 0.5) * C });
                k = parent.get(k);
            }
            path.reverse();
            this.path = path;
            this.pathTarget = new THREE.Vector3(targetPos.x, 0, targetPos.z);
        }

        // True si el circulo (x, z, radio 0,4) toca una pared, un tabique
        // inclinado o un mueble: la entidad se desliza, nunca los atraviesa.
        hitsWall(x, z) {
            const r = 0.4;
            for (const box of this._wallBoxes) {
                if (x + r > box.minX && x - r < box.maxX && z + r > box.minZ && z - r < box.maxZ) return true;
            }
            if (this.worldSystem && this.worldSystem.slantedAABBs) {
                for (const b of this.worldSystem.slantedAABBs) {
                    if (x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ) return true;
                }
            }
            for (const b of this._furniture) {
                if (b.aabb && x + r > b.aabb.minX && x - r < b.aabb.maxX && z + r > b.aabb.minZ && z - r < b.aabb.maxZ) return true;
            }
            return false;
        }

        // Avanza por el camino con deslizamiento por ejes: primero X y luego
        // Z por separado, comprobando choques. Si se atasca contra un
        // obstaculo (mueble movido, etc.) se recalcula el camino. Sin camino
        // (destino tapado o ultimos metros) se aproxima directo deslizando.
        followPath(dt, walkableCells) {
            if (!this.path.length) {
                if (this.pathTarget) {
                    const dx = this.pathTarget.x - this.pos.x;
                    const dz = this.pathTarget.z - this.pos.z;
                    const d = Math.hypot(dx, dz);
                    if (d > 0.6) {
                        const step = this.speed * dt;
                        const nx = this.pos.x + (dx / d) * step;
                        const nz = this.pos.z + (dz / d) * step;
                        this.yaw = Math.atan2(dx, dz);
                        let moved = false;
                        if (!this.hitsWall(nx, this.pos.z)) { this.pos.x = nx; moved = true; }
                        if (!this.hitsWall(this.pos.x, nz)) { this.pos.z = nz; moved = true; }
                        if (moved) this._blocked = 0;
                        else {
                            this._blocked += dt;
                            if (this._blocked > 0.7) {
                                this._blocked = 0;
                                this.pathTarget = null;
                            }
                        }
                    }
                }
                this.pathTimer = Math.max(this.pathTimer, 0.5);   // no recalcular a cada frame
                return;
            }
            const target = this.path[0];
            const dx = target.x - this.pos.x;
            const dz = target.z - this.pos.z;
            const d = Math.hypot(dx, dz);
            if (d < 0.55) {
                this.path.shift();
                this._blocked = 0;
                return;
            }
            const step = this.speed * dt;
            const nx = this.pos.x + (dx / d) * step;
            const nz = this.pos.z + (dz / d) * step;
            this.yaw = Math.atan2(dx, dz);
            let moved = false;
            if (!this.hitsWall(nx, this.pos.z)) { this.pos.x = nx; moved = true; }
            if (!this.hitsWall(this.pos.x, nz)) { this.pos.z = nz; moved = true; }
            if (moved) this._blocked = 0;
            else {
                this._blocked += dt;
                if (this._blocked > 0.7) {
                    this._blocked = 0;
                    this.path = [];
                    this.pathTimer = 0;   // recalcular ya
                }
            }
        }

        // Trazado de rayo 2D para comprobar línea de visión (muros y pilares bloquean el rayo)
        hasLineOfSight(playerPos, wallBoxes) {
            const x0 = this.pos.x;
            const z0 = this.pos.z;
            const x1 = playerPos.x;
            const z1 = playerPos.z;

            const dx = x1 - x0;
            const dz = z1 - z0;

            for (let box of wallBoxes) {
                let tmin = 0.0, tmax = 1.0;

                if (Math.abs(dx) < 0.0001) {
                    if (x0 < box.minX || x0 > box.maxX) continue;
                } else {
                    let t1 = (box.minX - x0) / dx;
                    let t2 = (box.maxX - x0) / dx;
                    if (t1 > t2) { let tmp = t1; t1 = t2; t2 = tmp; }
                    tmin = Math.max(tmin, t1);
                    tmax = Math.min(tmax, t2);
                    if (tmin > tmax) continue;
                }

                if (Math.abs(dz) < 0.0001) {
                    if (z0 < box.minZ || z0 > box.maxZ) continue;
                } else {
                    let t1 = (box.minZ - z0) / dz;
                    let t2 = (box.maxZ - z0) / dz;
                    if (t1 > t2) { let tmp = t1; t1 = t2; t2 = tmp; }
                    tmin = Math.max(tmin, t1);
                    tmax = Math.min(tmax, t2);
                    if (tmin > tmax) continue;
                }

                return false;
            }

            return true;
        }

        stun(seconds = 4.0) {
            this.state = 'STUNNED';
            this.stunTimer = seconds;
            audio.playMonsterRoar();
        }

        update(dt, playerPos, playerSanity, wallBoxes, walkableCells, onKill, furnitureBodies) {
            this._wallBoxes = wallBoxes;
            this._furniture = furnitureBodies || [];

            // Reaparicion: la primera salida la activa el anfitrion (canRespawn)
            // y si el jugador se aleja demasiado, desaparece y vuelve mas tarde
            if (!this.active) {
                if (!this.canRespawn) return;
                this.respawnTimer -= dt;
                if (this.respawnTimer <= 0) {
                    this.respawnTimer = 0;
                    this.spawnDistant(walkableCells, playerPos);
                }
                return;
            }

            const dist = this.pos.distanceTo(playerPos);

            // Si el jugador se aleja mucho, la entidad desaparece (nada de
            // presion constante desde el otro lado del mapa) y vuelve luego
            if (dist > 110) {
                this.active = false;
                this.mesh.visible = false;
                this.path = [];
                this.respawnTimer = 35 + Math.random() * 35;
                return;
            }

            // Contacto DIRECTO = muerte inmediata. Se comprueba SIEMPRE (incluso
            // aturdida) y solo si la entidad tiene linea de vision: nunca mata a
            // traves de una pared. La distancia es horizontal (XZ): la altura
            // del jugador (1,55 m) NO cuenta, o el contacto nunca se detectaria.
            const TOUCH_DIST = 0.85;   // cuerpo entidad (0,4) + radio jugador (0,35) + holgura
            const distXZ = Math.hypot(this.pos.x - playerPos.x, this.pos.z - playerPos.z);
            if (distXZ < TOUCH_DIST && this.hasLineOfSight(playerPos, wallBoxes)) {
                audio.playJumpscare();
                onKill("LA ENTIDAD TE ALCANZÓ Y TE DEVORÓ EN LA PENUMBRA");
                return;
            }

            this.tentacles.forEach((t, idx) => {
                t.rotation.x = Math.sin(Date.now() * 0.02 + idx) * 0.18;
                t.rotation.y += (Math.random() - 0.5) * 0.04;
            });

            if (this.state === 'STUNNED') {
                this.stunTimer -= dt;
                this.mesh.position.x += (Math.random() - 0.5) * 0.06;
                if (this.stunTimer <= 0) this.state = 'SEARCHING';
                return;
            }

            const glitch = document.getElementById('glitch-overlay');
            if (dist < 14) {
                glitch.style.display = 'block';
                glitch.style.opacity = `${(1 - dist / 14) * 0.55}`;
                if (Math.random() < 0.03) audio.flickerHum();
            } else {
                glitch.style.display = 'none';
            }

            const canSeePlayer = this.hasLineOfSight(playerPos, wallBoxes);
            const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
            const toPlayer = new THREE.Vector3().subVectors(playerPos, this.pos).normalize();
            const inFOV = forward.dot(toPlayer) > 0.25;

            // Recalcular el camino (como mucho cada 0,7 s): el destino cambia
            // con el jugador y el camino queda obsoleto. En persecucion sin
            // linea de vision se va a la ULTIMA posicion vista (nada de
            // saber donde estas a traves de las paredes).
            this.pathTimer -= dt;
            if (this.pathTimer <= 0) {
                this.pathTimer = 0.7;
                if (this.state === 'CHASING') {
                    this.recomputePath(this.lastKnownPos, walkableCells);
                } else if (!this.path.length) {
                    this.pickWanderTarget(walkableCells, playerPos);
                }
            }

            if (this.state === 'WANDERING') {
                this.speed = 1.5;

                if (canSeePlayer && ((dist < 20 && inFOV) || dist < 4.0 || playerSanity < 25)) {
                    this.state = 'CHASING';
                    this.lastKnownPos.copy(playerPos);
                    this.path = [];
                    audio.playMonsterRoar();
                } else {
                    this.followPath(dt, walkableCells);
                }
            } else if (this.state === 'CHASING') {
                this.speed = 4.8;

                if (canSeePlayer) {
                    this.lastKnownPos.copy(playerPos);
                    if (Math.random() < 0.01) audio.playMonsterRoar();
                } else {
                    const toLast = Math.hypot(this.lastKnownPos.x - this.pos.x, this.lastKnownPos.z - this.pos.z);
                    if (toLast < 1.2) {
                        this.state = 'SEARCHING';
                        this.searchTimer = 5.0;
                    }
                }
                this.followPath(dt, walkableCells);
            } else if (this.state === 'SEARCHING') {
                this.searchTimer -= dt;
                this.yaw += Math.sin(Date.now() * 0.005) * 0.04;

                if (canSeePlayer && dist < 20) {
                    this.state = 'CHASING';
                    this.lastKnownPos.copy(playerPos);
                    this.path = [];
                    audio.playMonsterRoar();
                } else if (this.searchTimer <= 0) {
                    this.state = 'WANDERING';
                    this.pickWanderTarget(walkableCells, playerPos);
                }
            }

            this.mesh.position.x = this.pos.x;
            this.mesh.position.z = this.pos.z;
            this.mesh.position.y = 0;
            this.mesh.rotation.y = this.yaw;

            // Contacto directo tras el movimiento de este frame (con la vision
            // del frame: los muros no se mueven entre medias)
            const distXZ2 = Math.hypot(this.pos.x - playerPos.x, this.pos.z - playerPos.z);
            if (distXZ2 < TOUCH_DIST && canSeePlayer) {
                audio.playJumpscare();
                onKill("LA ENTIDAD TE ALCANZÓ Y TE DEVORÓ EN LA PENUMBRA");
            }
        }
    }
