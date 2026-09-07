/* ==========================================================================
       5. SISTEMA DE DIBUJO CON TIZA Y VIEWMODEL 3D EN MANO
       ========================================================================== */
    class ChalkDrawingSystem {
        constructor(scene, camera) {
            this.scene = scene;
            this.camera = camera;
            this.maxDots = 3000;
            this.geo = new THREE.PlaneGeometry(0.07, 0.07);
            this.mat = new THREE.MeshBasicMaterial({
                map: TextureGenerator.createChalkDotTexture(),
                transparent: true,
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: -1
            });
            this.instMesh = new THREE.InstancedMesh(this.geo, this.mat, this.maxDots);
            this.instIndex = 0;
            this.lastDrawPoint = null;
            this.scene.add(this.instMesh);

            const dummy = new THREE.Object3D();
            dummy.position.set(0, -999, 0);
            dummy.updateMatrix();
            for (let i = 0; i < this.maxDots; i++) {
                this.instMesh.setMatrixAt(i, dummy.matrix);
            }
            this.instMesh.instanceMatrix.needsUpdate = true;

            this.chalkHandGroup = new THREE.Group();
            this.chalkStickMesh = new THREE.Mesh(
                new THREE.CylinderGeometry(0.016, 0.016, 0.18, 12),
                new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 })
            );
            this.chalkStickMesh.rotation.x = Math.PI / 4;
            this.chalkStickMesh.rotation.z = -Math.PI / 6;
            this.chalkHandGroup.add(this.chalkStickMesh);

            this.chalkHandGroup.position.set(0.24, -0.22, -0.42);
            this.chalkHandGroup.visible = false;
            this.camera.add(this.chalkHandGroup);
        }

        updateViewModel(hasChalk, isSelected, colorHex, isDrawing, chalkRatio = 1) {
            if (hasChalk && isSelected) {
                this.chalkHandGroup.visible = true;
                this.chalkStickMesh.material.color.set(colorHex);
                // La tiza se acorta según el medidor: se gasta al dibujar
                this.chalkStickMesh.scale.set(1, Math.max(0.25, chalkRatio), 1);
                if (isDrawing) {
                    this.chalkHandGroup.position.y = -0.22 + Math.sin(Date.now() * 0.04) * 0.008;
                    this.chalkHandGroup.position.z = -0.42 + Math.cos(Date.now() * 0.04) * 0.008;
                } else {
                    this.chalkHandGroup.position.set(0.24, -0.22, -0.42);
                }
            } else {
                this.chalkHandGroup.visible = false;
            }
        }

        addDot(point, normal, colorHex) {
            const dummy = new THREE.Object3D();
            dummy.position.copy(point).add(normal.clone().multiplyScalar(0.008));
            dummy.lookAt(point.clone().add(normal));
            dummy.updateMatrix();

            this.instMesh.setMatrixAt(this.instIndex, dummy.matrix);
            this.instMesh.setColorAt(this.instIndex, new THREE.Color(colorHex));

            this.instIndex = (this.instIndex + 1) % this.maxDots;
            this.instMesh.instanceMatrix.needsUpdate = true;
            if (this.instMesh.instanceColor) this.instMesh.instanceColor.needsUpdate = true;
        }
    }
