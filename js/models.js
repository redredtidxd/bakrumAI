/* ==========================================================================
       3. MODELOS PROCEDURALES Y FUNCIÓN MATEMÁTICA SNAP TO FLOOR
       ========================================================================== */
    // GRAVEDAD ABSOLUTA POR BOUNDING BOX (cero muebles flotando):
    // Asienta cualquier objeto (mesa, silla, armario, incluso rotado o tumbado)
    // calculando su caja envolvente exacta y ajustando el eje Y con la fórmula
    // estricta: mesh.position.y -= box.min.y  ->  la base toca exactamente Y = 0.
    function snapToFloor(object3D, targetY = 0) {
        object3D.position.y = 0;
        object3D.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(object3D);
        object3D.position.y -= box.min.y;   // Fórmula estricta: asienta sobre el suelo
        object3D.position.y += targetY;     // Margen opcional sobre el suelo
        object3D.updateMatrixWorld(true);
        return object3D;
    }

    const ModelBuilder = {
        createOfficeDesk(variant = 0) {
            const group = new THREE.Group();
            const woodMat = new THREE.MeshStandardMaterial({ color: 0x332519, roughness: 0.8 });
            const legMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.8, roughness: 0.3 });
            const handleMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.9, roughness: 0.2 });

            const top = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 0.85), woodMat);
            top.position.y = 0.72;
            group.add(top);

            const legGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.7, 8);
            const legPositions = [
                [-0.72, 0.35, -0.36],
                [0.72, 0.35, -0.36],
                [-0.72, 0.35, 0.36],
                [0.72, 0.35, 0.36]
            ];

            const legsToSpawn = (variant === 1) ? legPositions.slice(0, 3) : legPositions;
            legsToSpawn.forEach(pos => {
                const leg = new THREE.Mesh(legGeo, legMat);
                leg.position.set(...pos);
                group.add(leg);
            });

            const drawer = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.45, 0.74), woodMat);
            drawer.position.set(0.46, 0.45, 0);
            const handle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.02), handleMat);
            handle.position.set(0.46, 0.52, 0.38);
            group.add(drawer, handle);

            if (variant === 2) {
                // Volcada del revés con patas hacia arriba
                group.rotation.x = Math.PI;
                group.rotation.z = (Math.random() - 0.5) * 0.4;
                group.rotation.y = Math.random() * Math.PI * 2;
            } else if (variant === 1) {
                // Inclinada en el suelo por pata rota
                group.rotation.z = -0.35;
                group.rotation.y = (Math.random() - 0.5) * 0.6;
            } else {
                group.rotation.y = Math.random() * Math.PI * 2;
            }

            return group;
        },

        createOfficeChair(variant = 0) {
            const group = new THREE.Group();
            const fabricMat = new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.85 });
            const metalMat = new THREE.MeshStandardMaterial({ color: 0x141414, metalness: 0.7, roughness: 0.3 });

            const seat = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.05, 0.46), fabricMat);
            seat.position.y = 0.45;
            group.add(seat);

            const back = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.05), fabricMat);
            back.position.set(0, 0.72, -0.21);
            group.add(back);

            const strutGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.28, 8);
            const strutL = new THREE.Mesh(strutGeo, metalMat);
            const strutR = new THREE.Mesh(strutGeo, metalMat);
            strutL.position.set(-0.14, 0.56, -0.21);
            strutR.position.set(0.14, 0.56, -0.21);
            group.add(strutL, strutR);

            const legGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.45, 8);
            const legPositions = [
                [-0.18, 0.22, -0.18],
                [0.18, 0.22, -0.18],
                [-0.18, 0.22, 0.18],
                [0.18, 0.22, 0.18]
            ];

            const count = (variant === 2) ? 3 : 4;
            for (let i = 0; i < count; i++) {
                const leg = new THREE.Mesh(legGeo, metalMat);
                leg.position.set(...legPositions[i]);
                group.add(leg);
            }

            if (variant === 1) {
                // Caída de lado sobre la moqueta
                group.rotation.z = Math.PI / 2;
                group.rotation.y = Math.random() * Math.PI * 2;
            } else if (variant === 2) {
                // Inclinada en el suelo
                group.rotation.x = 0.38;
                group.rotation.y = Math.random() * Math.PI * 2;
            } else {
                group.rotation.y = Math.random() * Math.PI * 2;
            }

            return group;
        },

        createOfficeCabinet(opts = {}) {
            // Armario metálico de oficina/vestidor. Puntos fijos:
            //  * EXTERIOR liso y opaco por TODAS las caras (la espalda ya no
            //    parece una "puerta extra": antes tenía un panel crema luminoso
            //    con tubo de luz que desde atrás se leía como una mini-puerta).
            //  * Interior hueco REAL que solo se ve al abrir o arrancar las dos
            //    hojas delanteras (las 2 manijas típicas).
            //
            // opts:
            //   pose:      'stand' (de pie) | 'lean' (inclinado en la pared)
            //              | 'back' (boca arriba) | 'face' (boca abajo)
            //              | 'side' (de lado)
            //   doorState: 0 = 2 hojas puestas | 1 = una puesta + una en el suelo
            //              | 2 = sin hojas (ambas en el suelo)
            //   filled:    true/false -> con contenido de vestidor o vacío
            //   lean:      ángulo extra para pose 'lean'
            //
            // Devuelve { group, debris }:
            //   group = cuerpo ya orientado (SIN giro Y; el mundo gira Y y luego
            //           llama a snapToFloor). Debris = hojas sueltas / ropa que
            //           va PLANA en el suelo, en coordenadas locales del armario.
            const pose = opts.pose || 'stand';
            const randomDoor = () => (Math.random() < 0.4 ? 0 : (Math.random() < 0.7 ? 1 : 2));
            const doorState = opts.doorState === undefined ? randomDoor() : opts.doorState;
            const filled = opts.filled === undefined ? Math.random() < 0.55 : opts.filled;
            const lean = opts.lean || 0.14;

            const body = new THREE.Group();
            const debris = []; // elementos que van planos en el suelo

            const metalMat = new THREE.MeshStandardMaterial({ color: 0x34362f, roughness: 0.6, metalness: 0.5 });
            const steelDarkMat = new THREE.MeshStandardMaterial({ color: 0x20211b, roughness: 0.7, metalness: 0.4 });
            const handleMat = new THREE.MeshStandardMaterial({ color: 0xa9a9a1, metalness: 0.85, roughness: 0.3 });
            const interiorMat = new THREE.MeshStandardMaterial({ color: 0x6f6a5a, roughness: 0.95, metalness: 0.05 });

            const W = 1.0, H = 2.2, D = 0.56, T = 0.035;

            // ---- Carcasa hueca (exterior metálico por los 4 costados) ----
            const back = new THREE.Mesh(new THREE.BoxGeometry(W - 0.02, H - 0.02, T), steelDarkMat);
            back.position.set(0, H / 2, -D / 2 + T / 2);
            const left = new THREE.Mesh(new THREE.BoxGeometry(T, H, D), metalMat);
            left.position.set(-W / 2 + T / 2, H / 2, 0);
            const right = new THREE.Mesh(new THREE.BoxGeometry(T, H, D), metalMat);
            right.position.set(W / 2 - T / 2, H / 2, 0);
            const top = new THREE.Mesh(new THREE.BoxGeometry(W, T, D), metalMat);
            top.position.set(0, H - T / 2, 0);
            const bottom = new THREE.Mesh(new THREE.BoxGeometry(W, T, D), steelDarkMat);
            bottom.position.set(0, T / 2, 0);
            body.add(back, left, right, top, bottom);

            // ---- Estantes interiores (solo si está de pie o inclinado: con el
            //      cuerpo tumbado los estantes se ven de canto y quedan raros) ----
            const upright = (pose === 'stand' || pose === 'lean');
            if (upright) {
                const shelfYs = [0.62, 1.22];
                shelfYs.forEach((y, si) => {
                    const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.035, 0.46),
                        si === 0 ? steelDarkMat : interiorMat);
                    shelf.position.set(0, y, -0.03);
                    body.add(shelf);
                });
            }

            // ---- Contenido interior (ropa colgada) solo en armarios de pie con
            //      contenido; así la gravedad queda creíble en cada pose ----
            const clothPalette = [0x22242a, 0x3a3d45, 0x57534a, 0x8a8578, 0xa8a090, 0x24404d, 0x5d3f36, 0x6b6557, 0x3f3f46, 0x7a6b50, 0x45403a, 0x9b9386];
            const clothMats = clothPalette.map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.96 }));

            if (upright && filled) {
                // Barra de colgar
                const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.9, 8), handleMat);
                rod.rotation.z = Math.PI / 2;
                rod.position.set(0, 1.86, -0.05);
                body.add(rod);

                // Colgador + prenda
                const addHangerGarment = (seed) => {
                    const g = new THREE.Group();
                    const mat = clothMats[seed % clothMats.length];
                    const isLong = Math.random() < 0.45;
                    const ch = isLong ? 0.9 : 0.6;
                    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.3, ch, 1, 6), mat);
                    cloth.rotation.x = -Math.PI / 2;
                    cloth.position.y = -ch / 2 - 0.02;
                    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.0032, 5, 12), handleMat);
                    hook.position.y = 0.01;
                    g.add(cloth, hook);
                    return g;
                };

                const numClothes = 3 + Math.floor(Math.random() * 4);
                const usedX = [];
                for (let i = 0; i < numClothes; i++) {
                    const seed = i + Math.floor(Math.random() * 97);
                    let x = 0;
                    for (let a = 0; a < 12; a++) {
                        x = -0.3 + Math.random() * 0.6;
                        if (usedX.every(u => Math.abs(u - x) > 0.09)) break;
                    }
                    usedX.push(x);
                    const garment = addHangerGarment(seed);
                    garment.position.set(x, 1.86, -0.05);
                    garment.rotation.y = (Math.random() - 0.5) * 0.9;
                    body.add(garment);
                }

                // Cajas/carpetas en los estantes
                const itemColors = [0x6b4a2f, 0x8a6a40, 0x2f3a4a, 0x4a5c6b, 0x6b4a3a, 0x4a4840, 0x2c2c32, 0x7a6a50];
                const itemMats = itemColors.map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }));
                [0.62, 1.22].forEach((y) => {
                    const n = Math.floor(Math.random() * 4);
                    for (let i = 0; i < n; i++) {
                        const mat = itemMats[Math.floor(Math.random() * itemMats.length)];
                        const kind = Math.random();
                        let item;
                        if (kind < 0.45) {
                            item = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.13), mat);
                        } else if (kind < 0.75) {
                            item = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.02), mat);
                        } else {
                            item = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 10), mat);
                        }
                        item.position.set((Math.random() - 0.5) * 0.55, y + 0.05, -0.05 + (Math.random() - 0.5) * 0.2);
                        item.rotation.y = Math.random() * Math.PI;
                        body.add(item);
                    }
                });

                // Zapatos en el fondo
                if (Math.random() < 0.55) {
                    const shoeMat = new THREE.MeshStandardMaterial({ color: Math.random() < 0.5 ? 0x171512 : 0x55452f, roughness: 0.9 });
                    const numShoes = 1 + Math.floor(Math.random() * 2);
                    for (let s2 = 0; s2 < numShoes; s2++) {
                        const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.075, 0.26), shoeMat);
                        shoe.position.set((Math.random() - 0.5) * 0.55, 0.08, -0.05 + (Math.random() - 0.5) * 0.22);
                        shoe.rotation.y = Math.random() * Math.PI;
                        body.add(shoe);
                    }
                }
            } else if (upright && !filled) {
                // Armario vacío: solo el cajón bajo de metal + un par de perchas tiradas
                const emptyShelf = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.05, 0.44), steelDarkMat);
                emptyShelf.position.set(0, 0.45, -0.02);
                body.add(emptyShelf);
                if (Math.random() < 0.5) {
                    const pile = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.14),
                        clothMats[Math.floor(Math.random() * clothMats.length)]);
                    pile.position.set((Math.random() - 0.5) * 0.4, 0.5, (Math.random() - 0.5) * 0.2);
                    pile.rotation.y = Math.random() * Math.PI;
                    body.add(pile);
                }
            }

            // ---- Hojas delanteras (las "2 manijas típicas" van en la cara +Z) ----
            const doorW = W / 2 - 0.01;
            const doorH = H - 0.18;
            const doorGeo = new THREE.BoxGeometry(doorW, doorH, 0.035);
            const handleGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.4, 8);
            const makeDoor = (xPos, handleX) => {
                const d = new THREE.Mesh(doorGeo, metalMat);
                // Hoja montada: centrada en su bisagra (el pivot ya está en el
                // plano frontal +Z). Cero flotación hacia delante.
                d.position.set(xPos, doorH / 2 + 0.04, 0);
                const h = new THREE.Mesh(handleGeo, handleMat);
                h.position.set(handleX, 0, 0.035);
                d.add(h);
                return d;
            };
            // Hoja caída: plana en el suelo, con su manija hacia arriba
            const makeFallenDoor = () => {
                const g = new THREE.Group();
                const leaf = new THREE.Mesh(new THREE.BoxGeometry(doorW, 0.035, doorH), metalMat);
                leaf.position.y = 0.02;
                const h = new THREE.Mesh(handleGeo, handleMat);
                h.rotation.x = Math.PI / 2;
                h.position.set(doorW / 2 - 0.08, 0.06, -doorH / 2 + 0.2);
                g.add(leaf, h);
                return g;
            };

            // Ropa derramada (para armarios tumbados con contenido o puertas arrancadas)
            const addClothesDebris = (count) => {
                for (let i = 0; i < count; i++) {
                    const g = new THREE.Group();
                    const mat = clothMats[Math.floor(Math.random() * clothMats.length)];
                    const stacks = 2 + Math.floor(Math.random() * 3);
                    for (let st = 0; st < stacks; st++) {
                        const cw = 0.18 + Math.random() * 0.1;
                        const cd = 0.12 + Math.random() * 0.06;
                        const fold = new THREE.Mesh(new THREE.BoxGeometry(cw, 0.05, cd), mat);
                        fold.position.set((Math.random() - 0.5) * 0.16, 0.03 + st * 0.055, (Math.random() - 0.5) * 0.08);
                        fold.rotation.y = Math.random() * 0.6;
                        g.add(fold);
                    }
                    const ang = Math.random() * Math.PI * 2;
                    const rad = 0.55 + Math.random() * 0.75;
                    g.userData.offset = { x: Math.cos(ang) * rad, z: Math.sin(ang) * rad, rot: Math.random() * Math.PI * 2 };
                    debris.push(g);
                }
            };
            if (!upright && filled) addClothesDebris(2 + Math.floor(Math.random() * 2));

            // Puertas montadas / caídas según doorState
            const mountDoor = (side) => { // side = -1 (hoja izquierda) o +1 (derecha)
                const pivotX = side * (W / 2 - T / 2);
                // La hoja cierra hacia el centro: su centro va de la bisagra hacia
                // dentro (-side), NUNCA colgando fuera de la carcasa.
                const d = makeDoor(-side * (doorW / 2 - 0.005), -side * (doorW / 2 - 0.14));
                const pivot = new THREE.Group();
                pivot.position.set(pivotX, 0, D / 2 - 0.015); // bisagra en el plano frontal
                pivot.add(d);
                body.add(pivot);
                return pivot;
            };
            const fallenDoorOffset = (i) => {
                const ang = (i === 0 ? 0.5 : -0.5) + (Math.random() - 0.5) * 0.5;
                return {
                    x: Math.sin(ang) * 0.55,
                    z: D / 2 + 0.12 + Math.cos(ang) * 0.12 + Math.random() * 0.25,
                    rot: ang * 0.5 + (Math.random() - 0.5) * 0.3
                };
            };

            const mountCount = doorState === 0 ? 2 : (doorState === 1 ? 1 : 0);
            const mounted = [];
            for (let m = 0; m < mountCount; m++) {
                mounted.push(mountDoor(m === 0 ? 1 : -1));
            }
            // Una hoja puede quedar un poco abierta (solo de pie)
            if (upright && mounted.length === 2 && Math.random() < 0.45) {
                mounted[Math.floor(Math.random() * 2)].rotation.y = (Math.random() - 0.5) * 0.9;
            }

            const looseCount = doorState === 2 ? 2 : (doorState === 1 ? 1 : 0);
            for (let l = 0; l < looseCount; l++) {
                const leaf = makeFallenDoor();
                const off = fallenDoorOffset(l);
                leaf.userData.offset = off;
                debris.push(leaf);
            }

            // ---- Pose del cuerpo (tumbado/inclinado) ----
            const outer = new THREE.Group();
            outer.add(body);
            if (pose === 'lean') {
                body.rotation.x = -lean;
            } else if (pose === 'back') {
                body.rotation.x = -Math.PI / 2; // puertas mirando arriba
            } else if (pose === 'face') {
                body.rotation.x = Math.PI / 2;  // espalda mirando arriba
            } else if (pose === 'side') {
                body.rotation.z = -Math.PI / 2;
            }
            return { group: outer, debris };
        },

        createChalkBox(colorHex) {
            const group = new THREE.Group();
            const boxTex = TextureGenerator.createChalkBoxTexture();
            const boxMat = new THREE.MeshStandardMaterial({ map: boxTex, roughness: 0.85 });
            const chalkMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.98 });

            const box = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.16), boxMat);
            box.position.y = 0.06;
            group.add(box);

            for (let i = -1; i <= 1; i++) {
                const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.18, 8), chalkMat);
                stick.rotation.z = Math.PI / 2;
                stick.position.set(0, 0.08, i * 0.04);
                group.add(stick);
            }

            const chalkPiece = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.08, 8), chalkMat);
            chalkPiece.rotation.y = 0.5;
            chalkPiece.rotation.z = Math.PI / 2;
            chalkPiece.position.set(0.25, 0.015, 0.05);

            const dust = new THREE.Mesh(new THREE.CircleGeometry(0.06, 8), new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.4 }));
            dust.rotation.x = -Math.PI / 2;
            dust.position.set(0.25, 0.002, 0.05);

            group.add(chalkPiece, dust);
            return group;
        },

        createCameraModel() {
            const group = new THREE.Group();
            const bodyMat = new THREE.MeshStandardMaterial({ color: 0x181818, roughness: 0.7 });
            const silverMat = new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.7, roughness: 0.3 });
            const flashMat = new THREE.MeshBasicMaterial({ color: 0xcccccc });

            const body = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.16, 0.12), bodyMat);
            body.position.y = 0.08;
            const top = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.04, 0.12), silverMat);
            top.position.y = 0.18;
            const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 16), silverMat);
            lens.rotation.x = Math.PI / 2;
            lens.position.set(0.02, 0.08, 0.08);
            const flash = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.02), flashMat);
            flash.position.set(-0.07, 0.18, 0.05);

            group.add(body, top, lens, flash);
            return group;
        },

        createAlmondWater() {
            const group = new THREE.Group();
            const glassMat = new THREE.MeshStandardMaterial({ color: 0x435e48, roughness: 0.3, transparent: true, opacity: 0.85 });
            const capMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8 });

            const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.24, 12), glassMat);
            body.position.y = 0.12;
            const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.08, 12), glassMat);
            neck.position.y = 0.26;
            const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.03, 12), capMat);
            cap.position.y = 0.31;

            group.add(body, neck, cap);
            return group;
        },

        createBattery() {
            // Pila AA metálica: se puede encontrar tirada para recargar la linterna
            const group = new THREE.Group();
            const shellMat = new THREE.MeshStandardMaterial({ color: 0xd9d4c2, roughness: 0.35, metalness: 0.75 });
            const bandMat = new THREE.MeshStandardMaterial({ color: 0xa03a24, roughness: 0.5, metalness: 0.2 });
            const capMat = new THREE.MeshStandardMaterial({ color: 0x3c3c3c, metalness: 0.85, roughness: 0.3 });

            const body = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.085, 10), shellMat);
            body.position.y = 0.05;
            const band = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.022, 10), bandMat);
            band.position.y = 0.058;
            const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.018, 8), capMat);
            cap.position.y = 0.099;

            group.add(body, band, cap);
            return group;
        },

        createFloorNote() {
            // Nota tirada en el suelo: mas grande y con la hoja rayada visible
            // para que se encuentren de un vistazo (antes era un rectangulo
            // plano diminuto que pasaba desapercibido en la moqueta)
            const group = new THREE.Group();
            const paper = new THREE.Mesh(
                new THREE.PlaneGeometry(0.36, 0.46),
                new THREE.MeshBasicMaterial({
                    map: wallNoteTexture(4, 'portrait'),
                    transparent: true,
                    side: THREE.DoubleSide
                })
            );
            paper.rotation.x = -Math.PI / 2;
            paper.rotation.z = (Math.random() - 0.5) * 1.5;
            paper.position.y = 0.006;
            group.add(paper);
            return group;
        },

        // Nota PEGADA A LA PARED: variantes de fijacion (chincheta, cinta
        // horizontal, cintas en diagonal, papel rasgado o a secas) y de
        // orientacion (vertical u horizontal, con distintos giros). La textura
        // se genera con RNG determinista para que toda la sala vea la misma
        // nota. opts: { variant, aspect, rot } (ver pickWallNoteSpot).
        createWallNote(opts = {}) {
            const group = new THREE.Group();
            const portrait = opts.aspect !== 'landscape';
            const w = portrait ? 0.3 : 0.44;
            const h = portrait ? 0.4 : 0.3;
            const paper = new THREE.Mesh(
                new THREE.PlaneGeometry(w, h),
                new THREE.MeshBasicMaterial({
                    map: wallNoteTexture(opts.variant || 0, opts.aspect || 'portrait'),
                    transparent: true,
                    side: THREE.DoubleSide
                })
            );
            paper.rotation.z = opts.rot || 0;   // giro dentro del plano de la pared
            group.add(paper);
            return group;
        }
    };

    // ---- Textura de nota de pared: papel con rayas de escritura y la
    // variante de fijacion pintada encima (cache por variante + orientacion).
    // RNG con semilla FIJA: mismo dibujo en todas las partidas y clientes. ----
    const wallNoteTexCache = new Map();
    function wallNoteTexture(variant, aspect) {
        const ck = variant + '|' + aspect;
        let tex = wallNoteTexCache.get(ck);
        if (tex) return tex;
        const portrait = aspect !== 'landscape';
        const W = portrait ? 256 : 320;
        const H = portrait ? 320 : 256;
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');
        const rng = mulberry32(variant * 2654435761 + (portrait ? 40503 : 81203) + 0xC0FFEE);

        // Papel (el rasgado recorta el borde inferior)
        const paperColor = '#e2d9c0';
        if (variant === 3) {
            ctx.beginPath();
            ctx.moveTo(0, 0); ctx.lineTo(W, 0); ctx.lineTo(W, H - 16);
            for (let x = W; x >= 0; x -= W / 12) {
                ctx.lineTo(x, H - 16 + (rng() - 0.5) * 30);
            }
            ctx.closePath();
            ctx.fillStyle = paperColor;
            ctx.fill();
        } else {
            ctx.fillStyle = paperColor;
            ctx.fillRect(0, 0, W, H);
        }

        // Suciedad del papel
        for (let i = 0; i < 60; i++) {
            ctx.fillStyle = 'rgba(120, 100, 60, ' + (0.04 + rng() * 0.09).toFixed(3) + ')';
            ctx.fillRect(rng() * W, rng() * H, 3 + rng() * 9, 2 + rng() * 6);
        }

        // Rayas de escritura a mano
        ctx.strokeStyle = '#3a3628';
        ctx.lineWidth = 2.4;
        ctx.lineCap = 'round';
        ctx.globalAlpha = 0.8;
        const margin = 32;
        const lines = portrait ? 5 : 3;
        for (let li = 0; li < lines; li++) {
            ctx.beginPath();
            const y = margin + (H - margin * 2) * (li + 0.5) / lines;
            let x = margin + rng() * 22;
            ctx.moveTo(x, y);
            const n = 4 + Math.floor(rng() * 5);
            for (let s = 0; s < n; s++) {
                x += ((W - margin * 2) / n) * (0.75 + rng() * 0.5);
                ctx.lineTo(Math.min(W - margin, x), y + (rng() - 0.5) * 8);
            }
            ctx.stroke();
        }
        ctx.globalAlpha = 1;

        // Variante de fijacion
        if (variant === 0) {
            // Chincheta roja
            ctx.fillStyle = 'rgba(0,0,0,0.28)';
            ctx.beginPath(); ctx.arc(54, 54, 11, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#b32d1c';
            ctx.beginPath(); ctx.arc(48, 46, 9, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#e0483a';
            ctx.beginPath(); ctx.arc(46, 42, 4, 0, Math.PI * 2); ctx.fill();
        } else if (variant === 1) {
            // Cinta adhesiva arriba y abajo
            ctx.save(); ctx.globalAlpha = 0.5; ctx.fillStyle = '#e8dcae';
            ctx.translate(W / 2, 18); ctx.rotate((rng() - 0.5) * 0.25);
            ctx.fillRect(-W * 0.42, -9, W * 0.84, 18);
            ctx.restore();
            ctx.save(); ctx.globalAlpha = 0.5; ctx.fillStyle = '#e8dcae';
            ctx.translate(W / 2, H - 18); ctx.rotate((rng() - 0.5) * 0.25);
            ctx.fillRect(-W * 0.42, -9, W * 0.84, 18);
            ctx.restore();
        } else if (variant === 2) {
            // Cintas en las esquinas, en diagonal
            ctx.save(); ctx.globalAlpha = 0.5; ctx.fillStyle = '#e8dcae';
            ctx.translate(16, 16); ctx.rotate(-Math.PI / 4);
            ctx.fillRect(-26, -10, 52, 20);
            ctx.restore();
            ctx.save(); ctx.globalAlpha = 0.5; ctx.fillStyle = '#e8dcae';
            ctx.translate(W - 16, H - 16); ctx.rotate(-Math.PI / 4);
            ctx.fillRect(-26, -10, 52, 20);
            ctx.restore();
        } else if (variant === 3) {
            // Pliegue en la esquina superior izquierda
            ctx.fillStyle = 'rgba(90, 70, 40, 0.35)';
            ctx.beginPath();
            ctx.moveTo(0, 0); ctx.lineTo(W * 0.24, 0); ctx.lineTo(0, W * 0.24);
            ctx.closePath();
            ctx.fill();
        }

        // Borde del papel
        ctx.strokeStyle = 'rgba(80, 65, 40, 0.5)';
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, W - 2, H - (variant === 3 ? 18 : 2));

        tex = new THREE.CanvasTexture(canvas);
        wallNoteTexCache.set(ck, tex);
        return tex;
    }
