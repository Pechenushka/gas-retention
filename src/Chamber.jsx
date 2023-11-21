import React from 'react';
import PropTypes from 'prop-types';
import Matter from 'matter-js';
import Color from 'color';
import {maxwellPDF} from './utils';

// Константа швидкості, яка використовується для перетворення між швидкістю Matter.js і метрами
// за секунду (м/с)
const PARTICLE_SPEED = 0.05;

const isParticleAboveEscapeSpeed = function(particle, escapeSpeed) {
    // Перетворюємо швидкість у matter.js назад у метри за секунду (м/с) одиниця, яку ми використовуємо на графіку.
    let molecularSpeed = particle.speed / PARTICLE_SPEED;

    // Якщо поточна швидкість частинки дорівнює 0, це означає, що вона
     // ще не почала рухатися. У цьому випадку просто використовуємо molecularSpeed
     // ініціалізований під час створення.
    if (particle.speed === 0) {
        molecularSpeed = particle.molecularSpeed;
    }

    return molecularSpeed >= escapeSpeed;
};


/**
* Провіряємо чи є частинки що можуть вилетіти з камери
 */
const letParticlesEscape = function(particles, escapeSpeed) {
    particles.forEach(function(gasParticles) {
        gasParticles.forEach(function(p) {
            if (isParticleAboveEscapeSpeed(p, escapeSpeed)) {
                p.collisionFilter.category = 0;
            } else {
                p.collisionFilter.category = 1;
            }
        });
    });
};

/**
 * Костиль щоб не втрачати енергію. Бо matter.js гасить швидкість
 *
 * Взято звідси:
 *   https://jsfiddle.net/xaLtoc2g/
 */
const adjustE = function(p) {
    const baseSpeed = p.molecularSpeed * PARTICLE_SPEED;

    if (p.speed !== 0) {
        let speedMultiplier = baseSpeed / p.speed;

        Matter.Body.setVelocity(
            p, {
                x: p.velocity.x * speedMultiplier,
                y: p.velocity.y * speedMultiplier
            }
        );
    }
};

const updateParticleSpeed = function(p, molecularSpeed) {
    p.molecularSpeed = molecularSpeed;

    const baseSpeed = p.molecularSpeed * PARTICLE_SPEED;
    let speedMultiplier = baseSpeed / p.speed;

    Matter.Body.setVelocity(p, {
        x: p.velocity.x * speedMultiplier,
        y: p.velocity.y * speedMultiplier
    });
};

export default class Chamber extends React.Component {
    constructor(props) {
        super(props);

        this.width = 1000;
        this.height = 800;
        this.margin = 200;

        this.el = React.createRef();

        this.particles = null;
    }

    render() {
        return (
            <div id="ChamberPixiView" ref={this.el} />
        );
    }

    isOutOfBounds(pos) {
        return (
            pos.x < 0 ||
                pos.y < 0 ||
                pos.x > this.width ||
                pos.y > this.height
        );
    }

    removeEscapedParticles() {
        const me = this;

        const currentParticleCounts = [null, null, null];
        this.particles.forEach(function(gasParticles, idx) {
            currentParticleCounts[idx] = gasParticles.length;
        });

        this.particles.forEach(function(gasParticles) {
            gasParticles.forEach(function(p, idx, array) {
                if (
                    p.collisionFilter.category === 0 &&
                        me.isOutOfBounds(p.position)
                ) {
                    Matter.Composite.remove(me.engine.world, p);
                    array.splice(idx, 1);
                }
            });
        });

        this.particles.forEach(function(gasParticles, idx) {
            if (currentParticleCounts[idx].length !== gasParticles.length) {
                const proportion = gasParticles.length /
                      me.initialParticleCounts[idx];

                me.props.onParticleCountUpdated(idx, proportion * 100);
            }
        });
    }

    /**
      * Оновлення швидкості частинок на основі нової пропорції
     */
    updateParticleSpeeds(particles, distributionBucket, proportion) {
        let pIdx = 0;
        distributionBucket.forEach(function(bucket) {
            const particlesAtThisSpeed = Math.round(
                bucket.particleCount * (proportion / 100)
            );
            // Оновлюємо массив частинок.
            if (particlesAtThisSpeed > 0) {
                let i = 0;
                for (i; i < particlesAtThisSpeed; i++) {
                    const idx = pIdx + i;
                    if (idx > particles.length) {
                        continue;
                    }
                    const p = particles[pIdx + i];
                    if (p) {
                        updateParticleSpeed(p, bucket.speed);
                    }
                }
                pIdx += particlesAtThisSpeed;
            }
        });

        return particles;
    }

    /**
     * костиль щоб тримати відсотки дистрибуції після того як чатинки вилітають
     */
    refreshParticleSpeedDistribution() {
        const me = this;
        this.particles.forEach(function(gasParticles, idx) {
            const gasParticleCount = gasParticles.length;
            const initialCount = me.initialParticleCounts[idx];
            if (initialCount !== gasParticleCount) {
                me.updateParticleSpeeds(
                    gasParticles,
                    me.distributionBuckets[idx],
                    me.props.gasProportions[idx]);
            }
        });
    }

    makeParticle(gas, molecularSpeed) {
        const particleMargin = this.margin + 10;
        const particleColor = Color(gas.color);
        const p = Matter.Bodies.circle(
            (Math.random() * (this.width - particleMargin)) +
                (particleMargin / 2),
            (Math.random() * (this.height - particleMargin)) +
                (particleMargin / 2),
            gas.particleSize, {
                render: {
                    fillStyle: particleColor.hex(),
                    lineWidth: 3
                },
                restitution: 1,
                friction: 0,
                frictionAir: 0
            });

        Matter.Body.setInertia(p, Infinity);
        p.molecularSpeed = molecularSpeed;

        if (this.props.allowEscape &&
            isParticleAboveEscapeSpeed(p, this.props.escapeSpeed)
           ) {
            p.collisionFilter.category = 0;
        } else {
            p.collisionFilter.category = 1;
        }

        const direction = Math.random() * Math.PI * 2;
        p.direction = direction;
        Matter.Body.setVelocity(p, {
            x: Math.sin(direction) * (PARTICLE_SPEED * molecularSpeed),
            y: Math.cos(direction) * (PARTICLE_SPEED * -molecularSpeed)
        });

        return p;
    }

    drawParticles(activeGases=[], gasProportions=[], distributionBuckets) {
        const me = this;
        const particles = [];

        activeGases.forEach(function(gas, idx) {
            const proportion = gasProportions[idx];
            const buckets = distributionBuckets[idx];

            const p = [];

            buckets.forEach(function(bucket) {
                const particleCount = bucket.particleCount * (
                    proportion / 100);

                for (let i = 0; i < particleCount; i++) {
                    p.push(
                        me.makeParticle(gas, bucket.speed));
                }
            });

            particles[idx] = p;
        });

        return particles;
    }

    /**
        Оновлюємо всі масиви частинок
     */
    updateParticles(activeGases=[], gasProportions=[], distributionBuckets) {
        const me = this;
        const particles = [];

        activeGases.forEach(function(gas, idx) {
            const proportion = gasProportions[idx];
            const buckets = distributionBuckets[idx];

            const p = [];

            buckets.forEach(function(bucket) {
                const particleCount = bucket.particleCount * (
                    proportion / 100);

                for (let i = 0; i < particleCount; i++) {

                    p.push(
                        me.makeParticle(gas, bucket.speed));
                }
            });

            particles[idx] = p;
        });

        return particles;
    }

    /**
     * Генеруємо секції рпозподілу Максвела для газу
     *
     * Повертає масив кількостей частинок для кожної секції розподілу.
     */
    generateBuckets(gas) {
        const distributionBuckets = [];

        for (let i = 0; i < 2100; i += 20) {
            let particleCount = maxwellPDF(
                i / (460 / 1.5),
                gas.mass,
                this.props.temperature);

            particleCount *= 20;
            particleCount = Math.round(particleCount);

            distributionBuckets.push({
                speed: i,
                particleCount: particleCount
            });
        }

        return distributionBuckets;
    }

    refreshScene() {
        const me = this;

        if (this.particles) {
            this.particles.forEach(function(gasParticles) {
                Matter.Composite.remove(me.engine.world, gasParticles);
            });
        }

        this.distributionBuckets = [];
        const initialParticleCounts = [];
        this.props.activeGases.forEach(function(gas) {
            const buckets = me.generateBuckets(gas);

            const totalParticles = buckets.reduce(
                function(prev, cur) {
                    return prev + cur.particleCount;
                }, 0);

            initialParticleCounts.push(totalParticles);
            me.distributionBuckets.push(buckets);
        });

        this.initialParticleCounts = initialParticleCounts;
        this.particles = this.drawParticles(
            this.props.activeGases,
            this.props.gasProportions,
            this.distributionBuckets);

        this.particles.forEach(function(gasParticles) {
            Matter.Composite.add(me.engine.world, gasParticles);
        });

    }

    drawWalls() {
        const Bodies = Matter.Bodies;
        const margin = this.margin;
        const wallOptions = {
            isStatic: true,
            render: {
                fillStyle: 'white',
                strokeStyle: 'white',
                lineWidth: 0
            },
            collisionFilter: {
                mask: 1
            }
        };

        return [
            // нижня стінка
            Bodies.rectangle(
                0, this.height,
                this.width * 2, margin,
                wallOptions
            ),
            // права стінка
            Bodies.rectangle(
                this.width, 0,
                margin, this.height * 2,
                wallOptions
            ),
            // верхня стінка
            Bodies.rectangle(
                0, 0,
                this.width * 2, margin,
                wallOptions
            ),
            // ліва стінка
            Bodies.rectangle(
                0, 0,
                margin, this.height * 2,
                wallOptions
            ),
        ];
    }

    componentDidMount() {
        const Engine = Matter.Engine,
              Render = Matter.Render,
              Runner = Matter.Runner,
              Composite = Matter.Composite;

        const engine = Engine.create();
        this.engine = engine;
        engine.world.gravity.y = 0;

        const render = Render.create({
            element: this.el.current,
            engine: engine,
            width: this.width,
            height: this.height,
            options: {
                wireframes: false,
                background: 'white',
            }
        });

        const walls = this.drawWalls();
        Composite.add(engine.world, walls);

        Render.lookAt(render, {
            min: { x: 0, y: 0 },
            max: { x: this.width, y: this.height }
        });

        Render.run(render);

        const runner = Runner.create();
        this.runner = runner;
        Runner.run(runner, engine);
        if (!this.props.isPlaying) {
            Runner.stop(runner);
        }

        const me = this;
        Matter.Events.on(render, 'afterRender', function() {
            // Draw box where the walls are, since the physical walls are
            // invisible.
            const ctx = render.context;

            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.rect(
                me.margin / 2,
                (me.margin - 50) / 2,
                me.width - (me.margin * 2),
                me.height - ((me.margin - 25) * 2)
            );
            ctx.stroke();
        });

        let counter0 = 0;
        Matter.Events.on(engine, 'beforeUpdate', function(e) {
            if (e.timestamp >= counter0 + 500) {
                me.particles.forEach(function(gasParticles) {
                    gasParticles.forEach(function(p) {
                        adjustE(p);
                    });
                });

                counter0 = e.timestamp;
            }
        });

        this.refreshScene();

        let counter1 = 0;
        Matter.Events.on(engine, 'afterUpdate', function(e) {
            if (e.timestamp >= counter1 + 200) {
                if (me.props.allowEscape) {
                    me.removeEscapedParticles();
                    letParticlesEscape(me.particles, me.props.escapeSpeed);
                }

                me.refreshParticleSpeedDistribution();

                counter1 = e.timestamp;
            }
        });
    }

    componentDidUpdate(prevProps) {
        if (
            prevProps.activeGases !== this.props.activeGases ||
                prevProps.temperature !== this.props.temperature
           ) {
            this.refreshScene();
        }

        if (
            !this.props.isPlaying &&
                prevProps.gasProportions !== this.props.gasProportions
        ) {
            this.refreshScene();
        }

        if (prevProps.isPlaying !== this.props.isPlaying) {
            this.refreshRunner(
                this.runner, this.engine, this.props.isPlaying);
        }

        const me = this;
        if (prevProps.allowEscape !== this.props.allowEscape) {
            // даємо частинкам можливість вийти.
            this.particles.forEach(function(gasParticles) {
                gasParticles.forEach(function(p) {
                    if (!me.props.allowEscape) {
                        p.collisionFilter.category = 1;
                    } else if (
                        isParticleAboveEscapeSpeed(p, me.props.escapeSpeed)
                    ) {
                        p.collisionFilter.category = 0;
                    }
                });
            });
        }

        if (this.props.allowEscape &&
            prevProps.escapeSpeed !== this.props.escapeSpeed
           ) {
            letParticlesEscape(this.particles, this.props.escapeSpeed);
        }
    }

    refreshRunner(runner, engine, isPlaying) {
        if (isPlaying) {
            engine.timing.timeScale = 1;
            Matter.Runner.start(runner, engine);
        } else {
            engine.timing.timeScale = 0;
            Matter.Runner.stop(runner);
        }
    }
}

Chamber.propTypes = {
    activeGases: PropTypes.array.isRequired,
    gasProportions: PropTypes.array.isRequired,
    isPlaying: PropTypes.bool.isRequired,
    allowEscape: PropTypes.bool.isRequired,
    escapeSpeed: PropTypes.number.isRequired,
    temperature: PropTypes.number.isRequired,
    onParticleCountUpdated: PropTypes.func.isRequired
};
