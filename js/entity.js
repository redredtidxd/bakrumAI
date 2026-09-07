/* ==========================================================================
       6. INTELIGENCIA ARTIFICIAL DEL MONSTRUO: PATRULLA, FOV Y SIGILO
       ========================================================================== */
    class BacteriophageEntity {
        constructor(scene) {
            this.scene = scene;
            this.mesh = new THREE.Group();
            this.state = 'WANDERING';
            this.speed = 1.8;
            this.pos = new THREE.Vector3(0, -999, 0);
            this.active = false;
            this.stunTimer = 0;
            this.searchTimer = 0;
            this.yaw = 0;
            this.targetWaypoint = new THREE.Vector3();
            this.lastKnownPos = new THREE.Vector3();
            this.tentacles = [];

            this.buildModel();
            this.mesh.visible = false;
            this.scene.add(this.mesh);
        }

        buildModel() {
            const blackMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.1, metalness: 0.95 });

            for (let i = 0; i < 6; i++) {
                const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 0.35, 6), blackMat);
                seg.position.y = 0.2 + i * 0.28;
                this.mesh.add(seg);
                this.tentacles.push(seg);
            }

            const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), blackMat);
            head.position.y = 1.9;
            this.mesh.add(head);

            const redEyeMat = new THREE.MeshBasicMaterial({ color: 0xff1111 });
            const eye1 = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), redEyeMat);
            eye1.position.set(0.06, 1.93, 0.14);
            const eye2 = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), redEyeMat);
            eye2.position.set(-0.06, 1.93, 0.14);
            this.mesh.add(eye1, eye2);

            for (let i = 0; i < 4; i++) {
                const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.05, 1.4, 5), blackMat);
                arm.position.set((i % 2 === 0 ? 0.3 : -0.3), 1.2, 0);
                arm.rotation.z = (i % 2 === 0 ? 0.4 : -0.4);
                this.mesh.add(arm);
                this.tentacles.push(arm);
            }
        }

        spawnDistant(walkableCells, playerPos) {
            const valid = walkableCells.filter(c => {
                const wx = (c.x + 0.5) * CELL_SIZE;
                const wz = (c.z + 0.5) * CELL_SIZE;
                return Math.hypot(wx - playerPos.x, wz - playerPos.z) >= 48.0;
            });

            if (valid.length === 0) return;
            const pick = valid[Math.floor(Math.random() * valid.length)];
            this.pos.set((pick.x + 0.5) * CELL_SIZE, 0, (pick.z + 0.5) * CELL_SIZE);
            this.mesh.position.copy(this.pos);
            this.mesh.visible = true;
            this.active = true;
            this.state = 'WANDERING';
            this.pickRandomWaypoint(walkableCells);
            audio.playMonsterRoar();
        }

        pickRandomWaypoint(walkableCells) {
            const pick = walkableCells[Math.floor(Math.random() * walkableCells.length)];
            this.targetWaypoint.set((pick.x + 0.5) * CELL_SIZE, 0, (pick.z + 0.5) * CELL_SIZE);
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
            if (!this.active) return;

            const dist = this.pos.distanceTo(playerPos);

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

            if (this.state === 'WANDERING') {
                this.speed = 1.8;

                if (canSeePlayer && ((dist < 22 && inFOV) || dist < 4.0 || playerSanity < 25)) {
                    this.state = 'CHASING';
                    this.lastKnownPos.copy(playerPos);
                    audio.playMonsterRoar();
                } else {
                    const toWp = new THREE.Vector3().subVectors(this.targetWaypoint, this.pos);
                    if (toWp.length() < 1.5) {
                        this.pickRandomWaypoint(walkableCells);
                    } else {
                        toWp.normalize();
                        this.yaw = Math.atan2(toWp.x, toWp.z);
                        this.pos.x += toWp.x * this.speed * dt;
                        this.pos.z += toWp.z * this.speed * dt;
                    }
                }
            } else if (this.state === 'CHASING') {
                this.speed = 4.7;

                if (canSeePlayer) {
                    this.lastKnownPos.copy(playerPos);
                    const dir = new THREE.Vector3().subVectors(playerPos, this.pos).normalize();
                    this.yaw = Math.atan2(dir.x, dir.z);
                    this.pos.x += dir.x * this.speed * dt;
                    this.pos.z += dir.z * this.speed * dt;

                    if (Math.random() < 0.01) audio.playMonsterRoar();
                } else {
                    const toLast = new THREE.Vector3().subVectors(this.lastKnownPos, this.pos);
                    if (toLast.length() < 1.2) {
                        this.state = 'SEARCHING';
                        this.searchTimer = 4.0;
                    } else {
                        toLast.normalize();
                        this.yaw = Math.atan2(toLast.x, toLast.z);
                        this.pos.x += toLast.x * this.speed * dt;
                        this.pos.z += toLast.z * this.speed * dt;
                    }
                }
            } else if (this.state === 'SEARCHING') {
                this.searchTimer -= dt;
                this.yaw += Math.sin(Date.now() * 0.005) * 0.04;

                if (canSeePlayer && dist < 22) {
                    this.state = 'CHASING';
                    this.lastKnownPos.copy(playerPos);
                    audio.playMonsterRoar();
                } else if (this.searchTimer <= 0) {
                    this.state = 'WANDERING';
                    this.pickRandomWaypoint(walkableCells);
                }
            }

            for (let box of wallBoxes) {
                if (this.pos.x + 0.4 > box.minX && this.pos.x - 0.4 < box.maxX && this.pos.z + 0.4 > box.minZ && this.pos.z - 0.4 < box.maxZ) {
                    this.pickRandomWaypoint(walkableCells);
                }
            }

            // La entidad también choca con los muebles empujables
            if (furnitureBodies) {
                for (const b of furnitureBodies) {
                    if (!b.aabb) continue;
                    const box = b.aabb;
                    if (this.pos.x + 0.4 > box.minX && this.pos.x - 0.4 < box.maxX && this.pos.z + 0.4 > box.minZ && this.pos.z - 0.4 < box.maxZ) {
                        this.pickRandomWaypoint(walkableCells);
                    }
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
