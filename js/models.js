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
            const woodMat = new THREE.MeshStandardMaterial({ map: TextureGenerator.createWoodTexture(), roughness: 0.85 });
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

            // Pata rota (variant 1): 3 patas, asi la mesa NO puede sostenerse
            // en pie y SIEMPRE nace caida (nunca flotando inclinada)
            const legsToSpawn = (variant === 1) ? legPositions.slice(0, 3) : legPositions;
            legsToSpawn.forEach(pos => {
                const leg = new THREE.Mesh(legGeo, legMat);
                leg.position.set(...pos);
                group.add(leg);
            });

            // Pedestal del cajon: un CUERPO HUECO de verdad, hecho de paneles
            // con la boca delantera REALMENTE abierta. Antes era un bloque
            // macizo: al abrir el cajon parecia que la bandeja se atravesaba
            // (no habia ningun hueco por donde saliera). Ahora se ve el hueco
            // interior y el cajon sale de el.
            const PX = 0.46, PY = 0.52, PD = 0.56, PH = 0.24, PT = 0.02;
            const panel = (w, h, d, x, y, z) => {
                const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), woodMat);
                m.position.set(PX + x, PY + y, z);
                group.add(m);
            };
            panel(PD, PT, PH, 0, PH / 2 + PT / 2, 0);            // techo del hueco
            panel(PD, PT, PH, 0, -PH / 2 - PT / 2, 0);           // suelo del hueco
            panel(PT, PH + PT * 2, PD, -PD / 2 + PT / 2, 0, 0);  // lateral izquierdo
            panel(PT, PH + PT * 2, PD, PD / 2 - PT / 2, 0, 0);   // lateral derecho
            panel(PD, PH + PT * 2, PT, 0, 0, -PD / 2 + PT / 2);  // fondo
            // Guias sobre las que se desliza el cajon (dentro del hueco)
            panel(0.04, 0.02, 0.42, -0.20, -PH / 2 + PT + 0.005, 0);
            panel(0.04, 0.02, 0.42, 0.20, -PH / 2 + PT + 0.005, 0);

            // Cajon HUECO (bandeja abierta por arriba) en TODAS las mesas:
            // tambien en las patas-arriba y volcadas (antes no tenian cajon
            // y parecian "mesas bug" sin interaccion). El cajon se desliza en
            // el eje local Z de la mesa, asi que en cualquier pose sale hacia
            // un lado y el objeto que esconda se desliza con el, nunca cae.
            const drawer = new THREE.Group();
            const dp = (w, h, d, x, y, z) => {
                const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), woodMat);
                m.position.set(x, y, z);
                drawer.add(m);
            };
            dp(0.36, 0.02, 0.5, 0, -0.07, 0);        // fondo (el objeto reposa aqui)
            dp(0.36, 0.12, 0.02, 0, 0.01, 0.25);     // frontal (alto, cara del cajon)
            dp(0.36, 0.06, 0.02, 0, -0.03, -0.25);   // trasera (baja)
            dp(0.02, 0.09, 0.5, -0.17, -0.025, 0);   // lateral izquierdo
            dp(0.02, 0.09, 0.5, 0.17, -0.025, 0);    // lateral derecho
            const handle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.02), handleMat);
            handle.position.set(0, 0.045, 0.265);
            drawer.add(handle);
            drawer.position.set(PX, PY - 0.02, 0);
            group.add(drawer);
            group.userData.drawer = { mesh: drawer, open: false };

            if (variant === 2) {
                // Boca abajo: patas arriba, apoyada plana en la mesa
                group.rotation.x = Math.PI;
                group.rotation.z = (Math.random() - 0.5) * 0.12;
                group.rotation.y = Math.random() * Math.PI * 2;
            } else if (variant === 1) {
                // Pata rota: CAIDA DE LADO, apoyada PLANA sobre la moqueta.
                // Se rota alrededor de X (no de Z): la mesa reposa sobre toda
                // su cara lateral (1,6 x 0,77 m), el tablero queda vertical y
                // las patas tumbadas en el suelo. Antes se rotaba alrededor
                // de Z y la mesa se apoyaba en el CANTO del tablero con las
                // patas en el aire: parecia medio flotando.
                group.rotation.x = -Math.PI / 2 + (Math.random() - 0.5) * 0.14;
                group.rotation.y = Math.random() * Math.PI * 2;
            } else if (variant === 3) {
                // Volcada hacia delante: el tablero queda vertical y las
                // patas delanteras tumbadas en el suelo
                group.rotation.x = Math.PI / 2 + (Math.random() - 0.5) * 0.18;
                group.rotation.y = Math.random() * Math.PI * 2;
            } else {
                // De pie: alineada con la rejilla del mundo (0/90/180/270).
                // Antes el giro Y era aleatorio y las mesas quedaban en
                // diagonal en las salas ("no rectas").
                group.rotation.y = Math.floor(Math.random() * 4) * Math.PI / 2;
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

            // Pata rota (variant 2): 3 patas -> la silla no se sostiene en pie
            // y nace caida; las poses caidas son SIEMPRE planas (nunca flotan
            // inclinadas a media altura)
            const count = (variant === 2) ? 3 : 4;
            for (let i = 0; i < count; i++) {
                const leg = new THREE.Mesh(legGeo, metalMat);
                leg.position.set(...legPositions[i]);
                group.add(leg);
            }

            if (variant === 1) {
                // Caida de lado: respaldo plano en el suelo, asiento vertical
                group.rotation.z = Math.PI / 2 + (Math.random() - 0.5) * 0.15;
                group.rotation.y = Math.random() * Math.PI * 2;
            } else if (variant === 2) {
                // Patas arriba: apoyada plana sobre asiento y respaldo
                group.rotation.x = Math.PI + (Math.random() - 0.5) * 0.12;
                group.rotation.y = Math.random() * Math.PI * 2;
            } else {
                // De pie: alineada con la rejilla (0/90/180/270), como las
                // mesas; las caidas conservan un giro aleatorio.
                group.rotation.y = Math.floor(Math.random() * 4) * Math.PI / 2;
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

    // ------------------------------------------------------------------
    // PUERTA FALSA (señuelo): marco + batiente(s) a escala real, pegada a
    // una cara de pared para que desde lejos parezca una salida. Variantes:
    // sencilla o doble, entornada, y con grafiti pintado encima (la textura
    // la genera world.js con graffitiTexture -> determinista por semilla).
    // El origen del grupo esta en el suelo, mirando a +Z; world.js la apoya
    // contra la cara REAL de la pared (wallFaceMap).
    // ------------------------------------------------------------------
    function createFakeDoorModel(o) {
        o = o || {};
        const group = new THREE.Group();
        const H = 2.05;
        const W = o.double ? 1.62 : 0.92;
        const T = 0.06;
        const paint = new THREE.Color(o.paint || 0x6d7a8a);
        const frameMat = new THREE.MeshStandardMaterial({ color: 0x232830, metalness: 0.55, roughness: 0.5 });
        const doorMat = new THREE.MeshStandardMaterial({ color: paint, roughness: 0.55, metalness: 0.15 });
        const insetMat = new THREE.MeshStandardMaterial({ color: paint.clone().multiplyScalar(0.68), roughness: 0.6 });
        const darkMat = new THREE.MeshStandardMaterial({ color: 0x14181f, metalness: 0.7, roughness: 0.35 });

        // Marco con cuerpo: jambas a los lados, dintel arriba y un umbral
        // oscuro abajo, todos con 0,1 m de fondo (antes era una lamina plana
        // que desde un lateral se veia "mal").
        const jambW = 0.09, frameD = 0.1;
        const jamb = (x) => {
            const m = new THREE.Mesh(new THREE.BoxGeometry(jambW, H, frameD), frameMat);
            m.position.set(x, H / 2, 0);
            group.add(m);
        };
        jamb(-W / 2 - jambW / 2);
        jamb(W / 2 + jambW / 2);
        const header = new THREE.Mesh(new THREE.BoxGeometry(W + jambW * 2, 0.09, frameD), frameMat);
        header.position.set(0, H + 0.045, 0);
        group.add(header);
        const sill = new THREE.Mesh(new THREE.BoxGeometry(W + jambW * 2, 0.05, frameD), darkMat);
        sill.position.set(0, 0.025, 0);
        group.add(sill);

        // Hoja con bisagra REAL en su canto: gira alrededor del borde de la
        // bisagra, no de su centro (antes la hoja se clavaba en el marco al
        // entornarse). La hoja se construye desplazada respecto al pivote:
        // hacia +X en las hojas normales (mirror=false) y espejada hacia -X
        // en la hoja derecha de las dobles (mirror=true), cuya bisagra esta
        // en la jamba derecha y debe cerrar hacia el CENTRO. Sin el espejo,
        // las dos hojas se construian hacia +X y la derecha quedaba FUERA
        // del marco, pegada por fuera de la jamba.
        const leaf = (pw, pivotX, ajar, mirror) => {
            const pivot = new THREE.Group();
            pivot.position.x = pivotX;
            const m = mirror ? -1 : 1;
            const face = new THREE.Mesh(new THREE.BoxGeometry(pw, H, T), doorMat);
            face.position.set(m * pw / 2, H / 2, 0);
            pivot.add(face);
            // Recuadros de panel (2 por hoja), enrasados con la cara frontal
            const iw = pw * 0.78, ih = H * 0.3;
            for (const iy of [H * 0.28, H * 0.62]) {
                const inset = new THREE.Mesh(new THREE.BoxGeometry(iw, ih, 0.022), insetMat);
                inset.position.set(m * pw / 2, iy, T / 2 + 0.012);
                pivot.add(inset);
            }
            // Tirador junto al canto LIBRE de la hoja (el interior)
            const handle = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.24, 0.028), darkMat);
            handle.position.set(m * (pw - 0.1), H * 0.48, T / 2 + 0.022);
            pivot.add(handle);
            // Grafiti pintado encima de la hoja (opcional)
            if (o.graffitiTex) {
                const g = new THREE.Mesh(
                    new THREE.PlaneGeometry(pw - 0.08, H - 0.25),
                    new THREE.MeshBasicMaterial({ map: o.graffitiTex, transparent: true, depthWrite: false })
                );
                g.position.set(m * pw / 2, H / 2 + 0.05, T / 2 + 0.022);
                pivot.add(g);
            }
            pivot.rotation.y = ajar;
            group.add(pivot);
            return pivot;
        };

        if (o.double) {
            // Doble puerta REAL: dos hojas con bisagra en las jambas
            // EXTERIORES que cierran hacia el centro, con su hueco central
            // (antes eran dos puertas sencillas pegadas, cada una girando
            // sobre su propio centro)
            const pw = W / 2 - 0.03;
            const a = o.ajar || 0.0;
            leaf(pw, -W / 2 + 0.005, -a, false);   // hoja izquierda: bisagra en la jamba izquierda
            leaf(pw, W / 2 - 0.005, a, true);       // hoja derecha: bisagra en la jamba derecha, espejada al centro
        } else {
            // Hoja unica: el ajar se NEGA para que la hoja abra SIEMPRE hacia
            // la habitacion. Con ajar positivo la hoja gira hacia -Z (el plano
            // del muro) y el canto libre se clavaba ~19 cm dentro de la pared:
            // "la puerta esta entreabierta atravesando la pared".
            leaf(W - 0.01, -W / 2 + 0.005, -(o.ajar || 0.0));
        }
        return group;
    }

    // ------------------------------------------------------------------
    // CAMARA DE SEGURIDAD de pared: soporte fijo + cabeza orientable con
    // objetivo, lente y LED rojo. world.js la monta en la cara real de un
    // muro y game.js gira la cabeza hacia el jugador cuando lo vigila.
    // ------------------------------------------------------------------
    function createSecurityCameraModel() {
        const group = new THREE.Group();
        const bracketMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.7, roughness: 0.4 });
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd8d8dc, metalness: 0.4, roughness: 0.55 });
        const lensMat = new THREE.MeshStandardMaterial({ color: 0x0a0c10, metalness: 0.8, roughness: 0.2 });
        const ledMat = new THREE.MeshStandardMaterial({ color: 0xff2a1a, emissive: 0xff2a1a, emissiveIntensity: 0 });

        const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.2), bracketMat);
        group.add(bracket);

        const head = new THREE.Group();
        head.position.set(0, 0.05, 0.05);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.05), bracketMat);
        arm.position.y = 0.03;
        head.add(arm);
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.13, 0.24), bodyMat);
        body.position.set(0, 0.11, 0);
        head.add(body);
        const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.08, 10), lensMat);
        lens.rotation.x = Math.PI / 2;
        lens.position.set(0, 0.11, 0.14);
        head.add(lens);
        const led = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 8), ledMat);
        led.position.set(0.06, 0.13, 0.09);
        head.add(led);
        group.add(head);

        group.userData = { head, ledMat };
        return group;
    }

    // ------------------------------------------------------------------
    // PUERTA DE METAL de sala de seguridad (estilo FNAF): marco + puerta de
    // paneles horizontales que SUBE al techo al abrirse. El panel de control
    // (con pantalla de pila) lo coloca world.js en la pared interior.
    // userData.door es el grupo de paneles que game.js desliza en Y.
    // ------------------------------------------------------------------
    function createMetalDoorModel() {
        const group = new THREE.Group();
        const metalMat = new THREE.MeshStandardMaterial({ color: 0x5a616b, metalness: 0.75, roughness: 0.45 });
        const frameMat = new THREE.MeshStandardMaterial({ color: 0x33363c, metalness: 0.6, roughness: 0.5 });

        const frame = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.4, 2.88), frameMat);
        frame.position.y = 1.2;
        group.add(frame);

        const door = new THREE.Group();
        for (let i = 0; i < 7; i++) {
            const p = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.32, 2.82), metalMat);
            p.position.y = i * 0.32 + 0.16;
            door.add(p);
        }
        group.add(door);

        group.userData = { door };
        return group;
    }

    // ------------------------------------------------------------------
    // MONITOR de pared (sala de seguridad): marco oscuro + pantalla cuyo
    // material se sustituye por el feed de camaras (render target) y una
    // capa de scanlines encima. world.js lo cuelga en la pared interior.
    // ------------------------------------------------------------------
    let scanlineTexCache = null;
    function scanlineTexture() {
        if (scanlineTexCache) return scanlineTexCache;
        const c = document.createElement('canvas');
        c.width = 8;
        c.height = 8;
        const x = c.getContext('2d');
        x.clearRect(0, 0, 8, 8);
        x.fillStyle = 'rgba(0, 0, 0, 0.55)';
        x.fillRect(0, 0, 8, 2);
        scanlineTexCache = new THREE.CanvasTexture(c);
        scanlineTexCache.wrapS = scanlineTexCache.wrapT = THREE.RepeatWrapping;
        scanlineTexCache.repeat.set(30, 22);
        return scanlineTexCache;
    }
    function createMonitorScreenModel() {
        const group = new THREE.Group();
        const frameMat = new THREE.MeshStandardMaterial({ color: 0x22252b, metalness: 0.6, roughness: 0.5 });
        const frame = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.05, 0.14), frameMat);
        frame.position.y = 0.55;
        group.add(frame);
        const screenMat = new THREE.MeshBasicMaterial({ color: 0x0a0d12 });
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.66, 0.9), screenMat);
        screen.position.set(0, 0.55, 0.071);
        group.add(screen);
        const scan = new THREE.Mesh(new THREE.PlaneGeometry(1.66, 0.9),
            new THREE.MeshBasicMaterial({ map: scanlineTexture(), transparent: true, opacity: 0.4, depthWrite: false }));
        scan.position.set(0, 0.55, 0.075);
        group.add(scan);
        group.userData = { screenMat };
        return group;
    }
