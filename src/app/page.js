'use client';

import { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, doc, onSnapshot, setDoc, getDoc } from 'firebase/firestore';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';

// --- Configuración de Firebase ---
const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID
};

const appIdPath = 'control-de-gastos-app';
const initialAuthToken = process.env.NEXT_PUBLIC_INITIAL_AUTH_TOKEN || null;
const LOCAL_STORAGE_KEY = 'activeUserId';

// --- Datos y Categorías Iniciales ---
const datosIniciales = {
    tarjetas: [],
    deudas: [],
    gastosDiarios: []
};

const categoriasDisponibles = ['Préstamo', 'Servicios', 'Alimentos', 'Transporte', 'Entretenimiento', 'Indumentaria', 'Salud', 'Educación', 'Mascotas', 'Otros', 'Transferencia', 'Electrodomésticos', 'Herramientas'];

function AuthWrapper() {
    // 1. HOOKS DE ESTADO (useState)
    const [tarjetas, setTarjetas] = useState([]);
    const [deudas, setDeudas] = useState([]);
    const [gastosDiarios, setGastosDiarios] = useState([]);
    const [seleccion, setSeleccion] = useState('General');
    const [nuevoItem, setNuevoItem] = useState({ descripcion: '', monto: '', cuotas: '', categoria: categoriasDisponibles[0] });
    const [itemEnEdicion, setItemEnEdicion] = useState(null);
    const [loading, setLoading] = useState(true);
    const [db, setDb] = useState(null);

    const [authUserId, setAuthUserId] = useState(null);
    const [activeUserId, setActiveUserId] = useState(null);
    const [idParaCargar, setIdParaCargar] = useState('');
    const [copySuccess, setCopySuccess] = useState('');
    const [postergada, setPostergada] = useState(false);
    const [cuotasPagadas, setCuotasPagadas] = useState('');

    // Nuevos estados para pestañas y tarjetas
    const [mostrarFormularioTarjeta, setMostrarFormularioTarjeta] = useState(false);
    const [nuevaTarjeta, setNuevaTarjeta] = useState({ nombre: '', limite: '', mostrarSaldo: true });
    const [verHistorial, setVerHistorial] = useState(false);

    //Estados de modo argentina
    const [calcPrecioContado, setCalcPrecioContado] = useState('');
    const [calcMontoCuota, setCalcMontoCuota] = useState('');
    const [calcCantCuotas, setCalcCantCuotas] = useState('');
    const [calcInflacion, setCalcInflacion] = useState('4'); // Inflación mensual estimada por defecto
    const [resultadoCalc, setResultadoCalc] = useState(null);

    // 2. HOOKS DE EFECTO (useEffect)
    useEffect(() => {
        if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
            console.error("Configuración de Firebase incompleta.");
            setLoading(false);
            return;
        }
        try {
            const app = initializeApp(firebaseConfig);
            const auth = getAuth(app);
            const firestore = getFirestore(app);
            setDb(firestore);

            const signInUser = async () => {
                try {
                    if (initialAuthToken) await signInWithCustomToken(auth, initialAuthToken);
                    else await signInAnonymously(auth);
                } catch (error) { console.error("Error de autenticación:", error); }
            };
            signInUser();

            const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
                if (user) {
                    setAuthUserId(user.uid);
                    const savedId = localStorage.getItem(LOCAL_STORAGE_KEY);
                    const idToUse = savedId || user.uid;
                    setActiveUserId(idToUse);
                    if (!savedId) {
                        localStorage.setItem(LOCAL_STORAGE_KEY, user.uid);
                    }
                } else {
                    setAuthUserId(null);
                    setActiveUserId(null);
                }
            });

            return () => unsubscribeAuth();
        } catch (error) {
            console.error("Error inicializando Firebase:", error);
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!db || !activeUserId) return;

        const loadAndMigrateData = async () => {
            setLoading(true);
            const userDocRefGeneral = doc(db, `artifacts/${appIdPath}/users/${activeUserId}/data/general`);
            const userDocRefOld = doc(db, `artifacts/${appIdPath}/users/${activeUserId}/data/tarjetas`);

            const generalSnapshot = await getDoc(userDocRefGeneral);

            if (generalSnapshot.exists()) {
                const data = generalSnapshot.data();
                setTarjetas(data.tarjetas || []);
                setDeudas(data.deudas || []);
                setGastosDiarios(data.gastosDiarios || []);
                setSeleccion("General");
            } else {
                const oldSnapshot = await getDoc(userDocRefOld);
                if (oldSnapshot.exists()) {
                    console.log("Migrando datos antiguos...");
                    const oldData = oldSnapshot.data();
                    const migratedData = {
                        tarjetas: oldData.tarjetas || [],
                        deudas: [],
                        gastosDiarios: []
                    };
                    await setDoc(userDocRefGeneral, migratedData);
                    setTarjetas(migratedData.tarjetas);
                    setDeudas(migratedData.deudas);
                    setGastosDiarios(migratedData.gastosDiarios || []);
                    setSeleccion("General");
                } else {
                    if (activeUserId === authUserId) {
                        await setDoc(userDocRefGeneral, datosIniciales);
                        setTarjetas(datosIniciales.tarjetas);
                        setDeudas(datosIniciales.deudas);
                        setGastosDiarios(datosIniciales.gastosDiarios || []);
                        setSeleccion("General");
                    } else {
                        setTarjetas([]);
                        setDeudas([]);
                        setGastosDiarios([]);
                        setSeleccion(null);
                    }
                }
            }
            setLoading(false);

            const unsubscribe = onSnapshot(userDocRefGeneral, (snapshot) => {
                if (snapshot.exists()) {
                    const data = snapshot.data();
                    setTarjetas(data.tarjetas || []);
                    setDeudas(data.deudas || []);
                    setGastosDiarios(data.gastosDiarios || []);
                }
            });

            return unsubscribe;
        };

        let unsubscribe;
        loadAndMigrateData().then(unsub => {
            unsubscribe = unsub;
        });

        return () => {
            if (unsubscribe) {
                unsubscribe();
            }
        };
    }, [db, activeUserId, authUserId]);

    // 3. FUNCIONES AUXILIARES (No son hooks)
    const saveToFirebase = async (data) => {
        if (activeUserId && db) {
            const userDocRef = doc(db, `artifacts/${appIdPath}/users/${activeUserId}/data/general`);
            try {
                await setDoc(userDocRef, { tarjetas, deudas, gastosDiarios, ...data }, { merge: true });
            } catch (e) { console.error("Error al guardar en Firebase: ", e); }
        }
    };

    const handleCargarId = () => {
        const idToLoad = idParaCargar.trim();
        if (idToLoad && idToLoad !== activeUserId) {
            setActiveUserId(idToLoad);
            localStorage.setItem(LOCAL_STORAGE_KEY, idToLoad);
        }
    };

    const handleResetToMyId = () => {
        localStorage.setItem(LOCAL_STORAGE_KEY, authUserId);
        setActiveUserId(authUserId);
        setIdParaCargar('');
    };

    // 4. HOOKS DE MEMORIZACIÓN (useMemo) - Deben ir ANTES de cualquier return
    const { esVistaGeneral, esVistaDeudas, esVistaGastosDiarios, tarjetaActiva, itemsActivos } = useMemo(() => {
        const esGeneral = seleccion === 'General';
        const esDeudas = seleccion === 'Deudas';
        const esGastosDiarios = seleccion === 'Gastos Diarios';

        let items = [];
        let tarjeta = null;

        if (esGeneral) {
            // Si es General, juntamos TODAS las compras de todas las tarjetas en una sola lista
            items = (tarjetas || []).flatMap(t => t.compras || []);
        } else if (esDeudas) {
            items = deudas || [];
        } else if (esGastosDiarios) {
            items = gastosDiarios || [];
        } else {
            tarjeta = tarjetas.find(t => t.nombre === seleccion);
            items = tarjeta?.compras || [];
        }

        return {
            esVistaGeneral: esGeneral, // Nueva bandera
            esVistaDeudas: esDeudas,
            esVistaGastosDiarios: esGastosDiarios,
            tarjetaActiva: tarjeta,
            itemsActivos: items
        };
    }, [seleccion, tarjetas, deudas, gastosDiarios]);

    const resumenMes = useMemo(() => {
        if (!itemsActivos) return 0;
        return itemsActivos.reduce((total, item) => {
            if (item.cuotasRestantes > 0 && !item.postergada) {
                return total + parseFloat(item.montoCuota);
            }
            return total;
        }, 0);
    }, [itemsActivos]);

    const resumenTotalGeneral = useMemo(() => {
        const calcularTotalMes = (items) => items.reduce((total, item) => {
            if (item.cuotasRestantes > 0 && !item.postergada) {
                return total + parseFloat(item.montoCuota);
            }
            return total;
        }, 0);
        const totalTarjetas = tarjetas.reduce((total, tarjeta) => total + calcularTotalMes(tarjeta.compras), 0);
        return totalTarjetas;
    }, [tarjetas]);

    const resumenTotalDeudas = useMemo(() => {
        const calcularTotalMes = (items) => items.reduce((total, item) => {
            if (item.cuotasRestantes > 0 && !item.postergada) {
                return total + parseFloat(item.montoCuota);
            }
            return total;
        }, 0);
        const totalDeudas = calcularTotalMes(deudas);
        return totalDeudas;
    }, [deudas]);

    // *** AQUÍ ESTABA EL PROBLEMA ***
    // Este useMemo debe estar aquí, antes del `if (loading)`
    const itemsVisualizados = useMemo(() => {
        if (!itemsActivos) return [];
        return itemsActivos.filter(item => {
            if (verHistorial) return item.pagada; // Solo pagadas
            return !item.pagada; // Solo pendientes
        });
    }, [itemsActivos, verHistorial]);

    const COLORES_GRAFICO = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#AF19FF', '#FF4560', '#00E396', '#775DD0'];

    const datosGrafico = useMemo(() => {
        if (!itemsVisualizados || itemsVisualizados.length === 0) return [];

        // 1. Agrupamos los montos por categoría
        const agrupado = itemsVisualizados.reduce((acc, item) => {
            const cat = item.categoria;
            // Sumamos el monto total de la compra (puedes cambiarlo a item.montoCuota si prefieres ver flujo mensual)
            acc[cat] = (acc[cat] || 0) + item.montoTotal;
            return acc;
        }, {});

        // 2. Convertimos el objeto en un array para Recharts
        return Object.keys(agrupado).map((key) => ({
            name: key,
            value: agrupado[key]
        })).filter(d => d.value > 0); // Eliminamos categorías con 0
    }, [itemsVisualizados]);

    const datosProyeccion = useMemo(() => {
        if (!itemsVisualizados || itemsVisualizados.length === 0) return [];

        // Creamos un mapa para los próximos 12 meses
        const meses = {};
        for (let i = 1; i <= 12; i++) {
            meses[`Mes ${i}`] = 0;
        }

        // Recorremos cada compra y sumamos su cuota a los meses correspondientes
        itemsVisualizados.forEach(item => {
            if (!item.pagada && item.cuotasRestantes > 0) {
                // Si la compra está postergada, empezamos a contar desde el mes 2
                const inicio = item.postergada ? 1 : 0;

                for (let i = 0; i < item.cuotasRestantes; i++) {
                    const numeroMes = inicio + i + 1; // +1 porque mostramos "Mes 1", "Mes 2"...
                    if (numeroMes <= 12) {
                        meses[`Mes ${numeroMes}`] += item.montoCuota;
                    }
                }
            }
        });

        // Convertimos a array para el gráfico y filtramos los meses que tengan deuda 0 al final (opcional)
        // O mejor, cortamos en el último mes que tenga deuda para no mostrar 12 barras vacías
        let data = Object.keys(meses).map(key => ({
            name: key,
            total: meses[key]
        }));

        // Encontramos el último mes con monto > 0 para cortar el gráfico ahí
        let ultimoMesConDatos = 0;
        data.forEach((d, index) => {
            if (d.total > 0) ultimoMesConDatos = index;
        });

        // Retornamos solo hasta donde hay datos (mínimo mostramos 3 meses para que se vea bonito)
        return data.slice(0, Math.max(3, ultimoMesConDatos + 1));
    }, [itemsVisualizados]);


    // --- LÓGICA GRÁFICOS GASTOS DIARIOS ---

    // 1. GRÁFICO MENSUAL (Día 1 al día actual)
    const datosGastosMes = useMemo(() => {
        if (!esVistaGastosDiarios) return [];

        const hoy = new Date();
        const mesActual = hoy.getMonth();
        const anioActual = hoy.getFullYear();
        const diaActual = hoy.getDate();

        const datosDelMes = [];
        // Creamos los días vacíos hasta hoy
        for (let i = 1; i <= diaActual; i++) {
            datosDelMes.push({ dia: i, label: `${i}`, monto: 0 });
        }

        // Rellenamos con datos (Usamos || [] por seguridad)
        (gastosDiarios || []).forEach(g => {
            if (!g.fecha) return;
            const [y, m, d] = g.fecha.split('-').map(Number);
            // Validamos que sea este mes y año
            if (y === anioActual && (m - 1) === mesActual && d <= diaActual) {
                datosDelMes[d - 1].monto += g.montoTotal;
            }
        });
        return datosDelMes;
    }, [gastosDiarios, esVistaGastosDiarios]);

    // 2. GRÁFICO ANUAL (Enero a Diciembre)
    const datosGastosAnual = useMemo(() => {
        if (!esVistaGastosDiarios) return [];

        const anioActual = new Date().getFullYear();
        const mesesNombres = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        const datosAnual = mesesNombres.map(mes => ({ name: mes, total: 0 }));

        (gastosDiarios || []).forEach(g => {
            if (!g.fecha) return;
            const [y, m, d] = g.fecha.split('-').map(Number);
            if (y === anioActual) {
                datosAnual[m - 1].total += g.montoTotal;
            }
        });
        return datosAnual;
    }, [gastosDiarios, esVistaGastosDiarios]);


    // 5. EVENT HANDLERS
    const handleAgregarTarjeta = (e) => {
        e.preventDefault();
        if (!nuevaTarjeta.nombre || !nuevaTarjeta.limite || parseFloat(nuevaTarjeta.limite) <= 0) {
            return;
        }
        const tarjetaAGuardar = {
            nombre: nuevaTarjeta.nombre.trim(),
            limite: parseFloat(nuevaTarjeta.limite),
            saldo: parseFloat(nuevaTarjeta.limite),
            compras: [],
            mostrarSaldo: nuevaTarjeta.mostrarSaldo
        };
        const tarjetasActualizadas = [...tarjetas, tarjetaAGuardar];
        saveToFirebase({ tarjetas: tarjetasActualizadas });
        setMostrarFormularioTarjeta(false);
        setNuevaTarjeta({ nombre: '', limite: '', mostrarSaldo: true });
    }

    //Función para calcular la inflación
    const calcularInflacion = (e) => {
        e.preventDefault(); // Evitamos que recargue la página si está en un form
        const pContado = parseFloat(calcPrecioContado);
        const pCuota = parseFloat(calcMontoCuota);
        const cuotas = parseInt(calcCantCuotas);
        const inf = parseFloat(calcInflacion) / 100;

        if (!pContado || !pCuota || !cuotas) return;

        // Fórmula de Valor Presente de una anualidad (suma de cuotas descontadas)
        let valorPresenteTotal = 0;
        for (let i = 1; i <= cuotas; i++) {
            // Traemos cada cuota al valor de hoy dividiendo por (1 + inflación)^mes
            valorPresenteTotal += pCuota / Math.pow(1 + inf, i);
        }

        const diferencia = pContado - valorPresenteTotal;
        const convieneCuotas = diferencia > 0;

        setResultadoCalc({
            valorPresente: valorPresenteTotal,
            diferencia: Math.abs(diferencia),
            conviene: convieneCuotas ? 'CUOTAS' : 'CONTADO',
            porcentajeAhorro: (Math.abs(diferencia) / pContado) * 100
        });
    };

    const obtenerInflacionOficial = async () => {
        try {
            // Usamos la API de ArgentinaDatos que devuelve la inflación mensual histórica
            const response = await fetch('https://api.argentinadatos.com/v1/finanzas/indices/inflacion');
            if (!response.ok) throw new Error('Error en API');

            const data = await response.json();

            // La API devuelve un array, tomamos el último dato (el más reciente)
            if (data && data.length > 0) {
                const ultimoDato = data[data.length - 1];
                setCalcInflacion(ultimoDato.valor.toString());
                alert(`¡Dato actualizado! Última inflación oficial: ${ultimoDato.valor}% (${ultimoDato.fecha})`);
            }
        } catch (error) {
            console.error("Error al obtener inflación:", error);
            alert("No se pudo obtener el dato oficial automáticamente. Por favor, ingrésalo manualmente.");
        }
    };

    const guardarItem = (e) => {
        e.preventDefault();
        if (!nuevoItem.monto || !(parseFloat(nuevoItem.monto) > 0) || !nuevoItem.descripcion) return;

        const montoNum = parseFloat(nuevoItem.monto);
        const cuotasNum = Number.isInteger(parseInt(nuevoItem.cuotas)) && nuevoItem.cuotas > 0 ? parseInt(nuevoItem.cuotas) : 1;
        const cuotasPagadasNum = Number.isInteger(parseInt(cuotasPagadas)) ? parseInt(cuotasPagadas) : 0;
        const cuotasRestantesNum = Math.max(0, cuotasNum - cuotasPagadasNum);

        const itemFinal = {
            descripcion: nuevoItem.descripcion,
            categoria: nuevoItem.categoria,
            montoTotal: montoNum,
            cuotas: cuotasNum,
            montoCuota: cuotasNum > 0 ? montoNum / cuotasNum : montoNum,
            cuotasRestantes: cuotasRestantesNum,
            pagada: cuotasRestantesNum === 0,
            postergada: postergada,
        };

        if (esVistaDeudas) {
            let deudasActualizadas;
            if (itemEnEdicion !== null) {
                deudasActualizadas = deudas.map((d, i) => i === itemEnEdicion ? itemFinal : d);
            } else {
                deudasActualizadas = [...deudas, itemFinal];
            }
            saveToFirebase({ deudas: deudasActualizadas });
        } else if (tarjetaActiva) {
            const tarjetasActualizadas = tarjetas.map(t => {
                if (t.nombre === seleccion) {
                    let saldoActualizado = t.saldo;
                    let comprasActualizadas;

                    if (itemEnEdicion !== null) {
                        const compraOriginal = t.compras[itemEnEdicion];
                        saldoActualizado += compraOriginal.montoTotal;
                        comprasActualizadas = t.compras.map((c, i) => i === itemEnEdicion ? itemFinal : c);
                    } else {
                        comprasActualizadas = [...t.compras, itemFinal];
                    }
                    saldoActualizado -= itemFinal.montoTotal;
                    return { ...t, saldo: saldoActualizado, compras: comprasActualizadas };
                }
                return t;
            });
            saveToFirebase({ tarjetas: tarjetasActualizadas });
        }

        setNuevoItem({ descripcion: '', monto: '', cuotas: '', categoria: categoriasDisponibles[0] });
        setItemEnEdicion(null);
        setPostergada(false);
        setCuotasPagadas('');
    };

    const eliminarItem = (itemIndex) => {
        if (esVistaDeudas) {
            const deudasActualizadas = deudas.filter((_, i) => i !== itemIndex);
            saveToFirebase({ deudas: deudasActualizadas });
        } else if (tarjetaActiva) {
            const itemAEliminar = tarjetaActiva.compras[itemIndex];
            if (!itemAEliminar) return;
            const montoADevolver = itemAEliminar.montoTotal;

            const tarjetasActualizadas = tarjetas.map(t =>
                t.nombre === seleccion
                    ? {
                        ...t,
                        saldo: t.saldo + montoADevolver,
                        compras: t.compras.filter((_, i) => i !== itemIndex)
                    }
                    : t
            );
            saveToFirebase({ tarjetas: tarjetasActualizadas });
        }
    };

    const iniciarEdicion = (itemIndex) => {
        const itemAEditar = itemsActivos[itemIndex];
        if (!itemAEditar) return;
        setNuevoItem({
            descripcion: itemAEditar.descripcion,
            monto: itemAEditar.montoTotal,
            cuotas: itemAEditar.cuotas,
            categoria: itemAEditar.categoria
        });
        setItemEnEdicion(itemIndex);
        setPostergada(itemAEditar.postergada || false);
        const pagadas = itemAEditar.cuotas - itemAEditar.cuotasRestantes;
        setCuotasPagadas(pagadas > 0 ? String(pagadas) : '');
        window.scrollTo(0, document.body.scrollHeight / 2);
    };

    const handleRecalcularSaldo = () => {
        if (!tarjetaActiva) return;
        const totalDeudaPendiente = tarjetaActiva.compras.reduce((total, compra) => {
            const deudaDeEstaCompra = compra.montoCuota * compra.cuotasRestantes;
            return total + deudaDeEstaCompra;
        }, 0);
        const saldoCorrecto = tarjetaActiva.limite - totalDeudaPendiente;
        const tarjetasActualizadas = tarjetas.map(t =>
            t.nombre === seleccion ? { ...t, saldo: saldoCorrecto } : t
        );
        saveToFirebase({ tarjetas: tarjetasActualizadas });
    };

    const handleCopyToClipboard = () => {
        if (!authUserId) return;
        const textArea = document.createElement("textarea");
        textArea.value = authUserId;
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            setCopySuccess('¡ID Copiado!');
            setTimeout(() => setCopySuccess(''), 2000);
        } catch (err) {
            console.error('Error al copiar ID: ', err);
        }
        document.body.removeChild(textArea);
    };

    const handlePagarResumen = () => {
        if (resumenMes <= 0) return;

        const procesarItems = (items) => {
            return items.map(item => {
                let updatedItem = { ...item };
                if (updatedItem.cuotasRestantes > 0 && !updatedItem.postergada) {
                    const nuevasCuotasRestantes = updatedItem.cuotasRestantes - 1;
                    updatedItem.cuotasRestantes = nuevasCuotasRestantes;
                    updatedItem.pagada = nuevasCuotasRestantes === 0;
                }
                if (updatedItem.postergada) {
                    updatedItem.postergada = false;
                }
                return updatedItem;
            });
        };

        if (esVistaDeudas) {
            const deudasActualizadas = procesarItems(deudas);
            saveToFirebase({ deudas: deudasActualizadas });
        } else if (tarjetaActiva) {
            const comprasDespuesDelPago = procesarItems(tarjetaActiva.compras);
            const tarjetasActualizadas = tarjetas.map(t => {
                if (t.nombre === seleccion) {
                    const nuevoSaldo = Math.min(t.limite, t.saldo + resumenMes);
                    return { ...t, saldo: nuevoSaldo, compras: comprasDespuesDelPago };
                }
                return t;
            });
            saveToFirebase({ tarjetas: tarjetasActualizadas });
        }
    };

    const handlePagarCuota = (itemIndex) => {
        const item = itemsActivos[itemIndex];
        if (!item || item.cuotasRestantes <= 0) return;

        const actualizarItem = (c, i) => {
            if (i === itemIndex) {
                const nuevasCuotasRestantes = c.cuotasRestantes - 1;
                return { ...c, cuotasRestantes: nuevasCuotasRestantes, pagada: nuevasCuotasRestantes === 0 };
            }
            return c;
        };

        if (esVistaDeudas) {
            const deudasActualizadas = deudas.map(actualizarItem);
            saveToFirebase({ deudas: deudasActualizadas });
        } else if (tarjetaActiva) {
            const tarjetasActualizadas = tarjetas.map(t => {
                if (t.nombre === seleccion) {
                    const nuevoSaldo = Math.min(t.limite, t.saldo + item.montoCuota);
                    const comprasActualizadas = t.compras.map(actualizarItem);
                    return { ...t, saldo: nuevoSaldo, compras: comprasActualizadas };
                }
                return t;
            });
            saveToFirebase({ tarjetas: tarjetasActualizadas });
        }
    };

    // 6. RENDERIZADO CONDICIONAL (Returns) - SOLO AQUÍ PUEDE HABER RETURNS
    if (loading) {
        return (
            <main className="flex min-h-screen flex-col items-center justify-center bg-gray-900 text-white font-sans">
                <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-teal-500"></div>
                <p className="mt-4 text-gray-400">Conectando...</p>
            </main>
        );
    }

    return (
        <main className="flex min-h-screen flex-col items-center p-4 sm:p-8 md:p-12 lg:p-24 bg-gray-900 text-white font-sans">
            <h1 className="text-3xl sm:text-4xl font-bold mb-4 sm:mb-8 text-center text-teal-400 drop-shadow-lg">
                Control de Gastos y Deudas 💸
            </h1>

            {authUserId && (
                <div className="bg-gray-800 p-4 rounded-xl shadow-md w-full max-w-sm sm:max-w-md mb-8 flex flex-col items-center border-t-4 border-teal-500">
                    <p className="text-sm text-gray-400">ID de este Dispositivo (para compartir):</p>
                    <div className="flex items-center space-x-2 mt-1">
                        <span className="font-mono text-xs sm:text-sm bg-gray-700 p-2 rounded-md truncate max-w-[200px]">{authUserId}</span>
                        <button onClick={handleCopyToClipboard} className="bg-teal-600 text-white p-2 rounded-md hover:bg-teal-700 transition">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                        </button>
                    </div>
                    {copySuccess && <p className="text-green-400 text-sm mt-2">{copySuccess}</p>}
                    <div className="w-full mt-4">
                        <p className="text-sm text-gray-400 mb-1">Cargar datos desde otro ID:</p>
                        <div className="flex items-center space-x-2">
                            <input
                                type="text"
                                placeholder="Pega un ID aquí"
                                value={idParaCargar}
                                onChange={(e) => setIdParaCargar(e.target.value)}
                                className="p-2 w-full rounded-md bg-gray-700 text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500 transition"
                            />
                            <button onClick={handleCargarId} className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition font-semibold">Cargar</button>
                            {authUserId !== activeUserId && (
                                <button onClick={handleResetToMyId} className="bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700 transition font-semibold">Mi ID</button>
                            )}
                        </div>
                        {authUserId !== activeUserId && (
                            <p className="text-yellow-400 text-xs mt-2 text-center">
                                Estás viendo los datos de otro usuario. Los cambios se guardarán en ese ID.
                            </p>
                        )}
                    </div>
                </div>
            )}

            <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full max-w-sm sm:max-w-md mb-8 border-t-4 border-teal-500">
                <h2 className="text-xl sm:text-2xl font-semibold mb-4 text-gray-300">
                    Seleccionar Tarjeta o Deudas
                </h2>
                <select
                    value={seleccion || ''}
                    onChange={(e) => setSeleccion(e.target.value)}
                    className="p-3 rounded-xl bg-gray-700 text-white w-full border border-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500 transition"
                >
                    <option value="General">Resumen General (Todas)</option>
                    {tarjetas.map(t => (
                        <option key={t.nombre} value={t.nombre}>{t.nombre}</option>
                    ))}
                    <option value="Gastos Diarios">Gastos del Día a Día</option>

                    <option value="Deudas">Deudas</option>
                </select>
                <button
                    onClick={() => setMostrarFormularioTarjeta(true)}
                    className="w-full mt-4 bg-green-600 text-white font-bold p-3 rounded-xl hover:bg-green-700 transition"
                >
                    + Añadir Nueva Tarjeta
                </button>
                {mostrarFormularioTarjeta && (
                    <form onSubmit={handleAgregarTarjeta} className="mt-4 p-4 bg-gray-700 rounded-xl flex flex-col gap-3 border-t-2 border-green-500">
                        <h3 className="text-lg font-semibold text-gray-300">Nueva Tarjeta</h3>
                        <input type="text" placeholder="Nombre de la tarjeta" value={nuevaTarjeta.nombre} onChange={(e) => setNuevaTarjeta({ ...nuevaTarjeta, nombre: e.target.value })} className="p-2 rounded-md bg-gray-600 text-white border border-gray-500 focus:ring-green-500" required />
                        <input type="number" placeholder="Límite de la tarjeta" value={nuevaTarjeta.limite} onChange={(e) => setNuevaTarjeta({ ...nuevaTarjeta, limite: e.target.value })} className="p-2 rounded-md bg-gray-600 text-white border border-gray-500 focus:ring-green-500" required />
                        <div className="flex items-center gap-2 text-gray-300 mt-2">
                            <input type="checkbox" id="mostrar-saldo-checkbox" checked={nuevaTarjeta.mostrarSaldo} onChange={(e) => setNuevaTarjeta({ ...nuevaTarjeta, mostrarSaldo: e.target.checked })} />
                            <label htmlFor="mostrar-saldo-checkbox">Mostrar saldo por defecto</label>
                        </div>
                        <div className="flex gap-2 mt-2">
                            <button type="submit" className="flex-1 bg-green-600 text-white p-2 rounded-md hover:bg-green-700 font-semibold transition">Guardar</button>
                            <button type="button" onClick={() => setMostrarFormularioTarjeta(false)} className="flex-1 bg-red-500 text-white p-2 rounded-md hover:bg-red-600">Cancelar</button>
                        </div>
                    </form>
                )}
            </div>

            {seleccion && (
                <>

                    {/* VERIFICAMOS SI HAY DATOS PARA MOSTRAR */}
                    {(tarjetas.length > 0 || deudas.length > 0) ? (
                        /* --- CONTENEDOR PRINCIPAL DE DOS COLUMNAS (GRID) --- */
                        <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8 mt-4">

                            {/* COLUMNA IZQUIERDA: RESÚMENES */}
                            <div className="flex flex-col gap-6">

                                {/* 1. SALDO (Solo si no es BBVA, no es Deudas y NO es General) */}
                                {!esVistaGastosDiarios && !esVistaGeneral && !esVistaDeudas && tarjetaActiva && !tarjetaActiva.nombre.toUpperCase().includes('BBVA') && tarjetaActiva.mostrarSaldo !== false && (
                                    <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full border-t-4 border-teal-500">
                                        <div className="flex justify-between items-center mb-2">
                                            <h2 className="text-xl font-semibold text-gray-300">Saldo de {tarjetaActiva.nombre}</h2>
                                            <button onClick={handleRecalcularSaldo} title="Recalcular saldo" className="bg-orange-600 text-white px-3 py-1 text-xs font-bold rounded-lg hover:bg-orange-700 transition">Recalcular</button>
                                        </div>
                                        <p className="text-4xl font-extrabold text-green-400">$ {tarjetaActiva.saldo.toLocaleString('es-AR')}</p>
                                        <p className="text-lg text-gray-400 mt-1">Límite: $ {tarjetaActiva.limite.toLocaleString('es-AR')}</p>
                                    </div>
                                )}

                                {/* 2. RESUMEN DEL MES */}
                                {!esVistaGastosDiarios && (
                                    <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full border-t-4 border-blue-500">
                                        <h2 className="text-xl font-semibold mb-2 text-gray-300">
                                            Resumen del Mes ({seleccion})
                                        </h2>
                                        <p className="text-4xl font-extrabold text-blue-400">$ {resumenMes.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                        {/* Deshabilitamos el pago si estamos en General */}
                                        <button onClick={handlePagarResumen} disabled={resumenMes <= 0 || esVistaGeneral} className="w-full mt-4 bg-blue-600 text-white font-bold p-3 rounded-xl hover:bg-blue-700 transition duration-300 ease-in-out shadow-md disabled:bg-gray-500 disabled:cursor-not-allowed">
                                            {esVistaGeneral ? "Selecciona una tarjeta para pagar" : "Pagar Resumen"}
                                        </button>
                                    </div>
                                )}


                                {/* 3. RESUMEN TOTAL TARJETAS (Solo si no es General, para no repetir) */}
                                {!esVistaGastosDiarios && !esVistaGeneral && (
                                    <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full border-t-4 border-purple-500">
                                        <h2 className="text-xl font-semibold mb-2 text-gray-300">
                                            Resumen Total De Tarjetas
                                        </h2>
                                        <p className="text-4xl font-extrabold text-purple-400">
                                            $ {resumenTotalGeneral.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </p>
                                    </div>
                                )}

                                {/* 4. RESUMEN DEUDAS */}
                                {!esVistaGastosDiarios && (
                                    <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full border-t-4 border-red-500">
                                        <h2 className="text-xl font-semibold mb-2 text-gray-300">
                                            Resumen Mensual de Deudas
                                        </h2>
                                        <p className="text-4xl font-extrabold text-red-400">
                                            $ {resumenTotalDeudas.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </p>
                                    </div>
                                )}


                                {/* --- MODO ARGENTINA: CALCULADORA INTELIGENTE --- */}
                                <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full border-t-4 border-sky-400">
                                    <h2 className="text-xl font-semibold mb-4 text-gray-300 flex items-center gap-2">
                                        🇦🇷 Asesor Financiero IA <span className="text-xs bg-sky-900 text-sky-200 px-2 py-1 rounded-full">SMART</span>
                                    </h2>
                                    <div className="flex flex-col gap-3">
                                        {/* INPUTS DE PRECIO */}
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label className="text-xs text-gray-400">Precio Contado (Cash)</label>
                                                <input type="number" value={calcPrecioContado} onChange={(e) => setCalcPrecioContado(e.target.value)} className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:ring-sky-500" placeholder="$ 100.000" />
                                            </div>
                                            <div>
                                                <label className="text-xs text-gray-400 flex justify-between items-center">
                                                    Inflación Mensual %
                                                    <button onClick={obtenerInflacionOficial} className="text-[10px] text-sky-400 hover:text-sky-300 underline cursor-pointer" title="Traer oficial">Oficial</button>
                                                </label>
                                                <input type="number" value={calcInflacion} onChange={(e) => setCalcInflacion(e.target.value)} className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:ring-sky-500" placeholder="4" />
                                            </div>
                                        </div>

                                        {/* INPUTS DE FINANCIACIÓN */}
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label className="text-xs text-gray-400 font-bold text-sky-300">Total Financiado</label>
                                                <input type="number" value={calcPrecioFinanciado} onChange={(e) => setCalcPrecioFinanciado(e.target.value)} className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 ring-1 ring-sky-900 focus:ring-sky-500" placeholder="$ 120.000" />
                                            </div>
                                            <div>
                                                <label className="text-xs text-gray-400">Cant. Cuotas</label>
                                                <input type="number" value={calcCantCuotas} onChange={(e) => setCalcCantCuotas(e.target.value)} className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:ring-sky-500" placeholder="3, 6, 12..." />
                                            </div>
                                        </div>

                                        <button onClick={calcularInflacion} className="bg-gradient-to-r from-sky-600 to-blue-700 hover:from-sky-700 hover:to-blue-800 text-white font-bold py-2 rounded transition mt-2 shadow-lg">
                                            Analizar Compra
                                        </button>

                                        {/* RESULTADOS */}
                                        {resultadoCalc && (
                                            <div className={`mt-4 p-4 rounded-xl border-2 ${resultadoCalc.veredicto.includes('CUOTAS') ? 'bg-green-900/20 border-green-500/50' : (resultadoCalc.veredicto === 'IMPOSIBLE' ? 'bg-red-900/20 border-red-600' : 'bg-yellow-900/20 border-yellow-500/50')}`}>

                                                <div className="flex justify-between items-start mb-2">
                                                    <div>
                                                        <p className="text-xs text-gray-400 uppercase tracking-wider">Veredicto</p>
                                                        <p className={`text-2xl font-black ${resultadoCalc.veredicto.includes('CUOTAS') ? 'text-green-400' : (resultadoCalc.veredicto === 'IMPOSIBLE' ? 'text-red-500' : 'text-yellow-400')}`}>
                                                            {resultadoCalc.veredicto}
                                                        </p>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="text-xs text-gray-400">Cuota estimada</p>
                                                        <p className="text-lg font-bold text-white">$ {resultadoCalc.valorCuotaReal.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</p>
                                                    </div>
                                                </div>

                                                {/* Datos Matemáticos */}
                                                <div className="bg-gray-800/50 p-2 rounded mb-2 text-xs flex justify-between">
                                                    <span>Inflación ganada: <span className={resultadoCalc.diferencia > 0 ? "text-green-400" : "text-red-400"}>$ {Math.abs(resultadoCalc.diferencia).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span></span>
                                                    <span>Costo Real: <span className="text-white">$ {resultadoCalc.valorPresente.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span></span>
                                                </div>

                                                {/* Consejos Contextuales (Si hay) */}
                                                {resultadoCalc.consejos.length > 0 && (
                                                    <div className="mt-2 border-t border-gray-600 pt-2">
                                                        <p className="text-xs font-bold text-gray-300 mb-1">Análisis de Contexto:</p>
                                                        <ul className="list-disc list-inside text-xs space-y-1">
                                                            {resultadoCalc.consejos.map((c, i) => (
                                                                <li key={i} className="text-gray-300">{c}</li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* COLUMNA DERECHA: GRÁFICOS */}
                            <div className="flex flex-col gap-6">

                                {/* 1. GRÁFICO DE TORTA (CATEGORÍAS) */}
                                {datosGrafico.length > 0 ? (
                                    <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full h-80 border-t-4 border-yellow-500 flex flex-col justify-center">
                                        <h2 className="text-xl font-semibold mb-2 text-gray-300 text-center">
                                            Distribución por Categoría
                                        </h2>
                                        <div className="h-full w-full">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <PieChart>
                                                    <Pie
                                                        data={datosGrafico}
                                                        cx="50%"
                                                        cy="50%"
                                                        innerRadius={60}
                                                        outerRadius={90}
                                                        paddingAngle={5}
                                                        dataKey="value"
                                                    >
                                                        {datosGrafico.map((entry, index) => (
                                                            <Cell key={`cell-${index}`} fill={COLORES_GRAFICO[index % COLORES_GRAFICO.length]} />
                                                        ))}
                                                    </Pie>
                                                    <Tooltip
                                                        formatter={(value) => `$${value.toLocaleString('es-AR')}`}
                                                        contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', color: '#fff', borderRadius: '8px' }}
                                                        itemStyle={{ color: '#fff' }}
                                                    />
                                                    <Legend iconType="circle" verticalAlign="bottom" height={36} />
                                                </PieChart>
                                            </ResponsiveContainer>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full h-80 border-t-4 border-gray-600 flex items-center justify-center opacity-50">
                                        <p className="text-gray-400 text-lg">Añade gastos para ver el análisis</p>
                                    </div>
                                )}

                                {/* 2. GRÁFICO DE BARRAS (PROYECCIÓN) */}
                                {datosProyeccion.length > 0 && (
                                    <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full h-80 border-t-4 border-cyan-500 flex flex-col justify-center">
                                        <h2 className="text-xl font-semibold mb-4 text-gray-300 text-center">
                                            Proyección de Pagos Futuros
                                        </h2>
                                        <div className="h-full w-full">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart data={datosProyeccion} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                                                    <XAxis
                                                        dataKey="name"
                                                        stroke="#9ca3af"
                                                        tick={{ fill: '#9ca3af', fontSize: 12 }}
                                                        axisLine={false}
                                                        tickLine={false}
                                                    />
                                                    <YAxis
                                                        stroke="#9ca3af"
                                                        tick={{ fill: '#9ca3af', fontSize: 10 }}
                                                        axisLine={false}
                                                        tickLine={false}
                                                        tickFormatter={(value) => `$${value / 1000}k`}
                                                    />
                                                    <Tooltip
                                                        cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                                                        formatter={(value) => [`$${value.toLocaleString('es-AR')}`, 'A pagar']}
                                                        contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', color: '#fff', borderRadius: '8px' }}
                                                        itemStyle={{ color: '#22d3ee' }}
                                                    />
                                                    <Bar
                                                        dataKey="total"
                                                        fill="#06b6d4"
                                                        radius={[4, 4, 0, 0]}
                                                        barSize={30}
                                                        animationDuration={1500}
                                                    />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </div>
                                    </div>
                                )}
                                {esVistaGastosDiarios && (
                                    <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full h-80 border-t-4 border-emerald-500 flex flex-col justify-center">
                                        <h2 className="text-xl font-semibold mb-4 text-gray-300 text-center">Tu Mes al Día (Acumulado)</h2>
                                        <div className="h-full w-full">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart data={datosGastosMes}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                                                    <XAxis dataKey="label" stroke="#9ca3af" tick={{ fill: '#9ca3af', fontSize: 12 }} interval={0} />
                                                    <YAxis stroke="#9ca3af" tick={{ fill: '#9ca3af', fontSize: 10 }} tickFormatter={(v) => `$${v / 1000}k`} />
                                                    <Tooltip contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', color: '#fff' }} formatter={(value) => [`$${value.toLocaleString('es-AR')}`, 'Gastado']} labelFormatter={(label) => `Día ${label}`} />
                                                    <Bar dataKey="monto" fill="#10b981" radius={[2, 2, 0, 0]} animationDuration={1000} />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </div>
                                    </div>
                                )}

                                {/* --- AQUI AGREGA ESTO: GRÁFICO 4 (AÑO HORMIGA) --- */}
                                {esVistaGastosDiarios && (
                                    <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full h-80 border-t-4 border-blue-500 flex flex-col justify-center mt-6">
                                        <h2 className="text-xl font-semibold mb-4 text-gray-300 text-center">Historial Anual {new Date().getFullYear()}</h2>
                                        <div className="h-full w-full">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart data={datosGastosAnual}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                                                    <XAxis dataKey="name" stroke="#9ca3af" tick={{ fill: '#9ca3af', fontSize: 12 }} />
                                                    <YAxis stroke="#9ca3af" tick={{ fill: '#9ca3af', fontSize: 10 }} tickFormatter={(v) => `$${v / 1000}k`} />
                                                    <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', color: '#fff' }} formatter={(value) => [`$${value.toLocaleString('es-AR')}`, 'Total Mes']} />
                                                    <Bar dataKey="total" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={20} />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </div>
                                    </div>
                                )}
                            </div>

                        </div>
                        /* --- FIN DEL GRID --- */
                    ) : (
                        // --- ESTO SE MUESTRA SI NO HAY TARJETAS (Usuario Nuevo) ---
                        <div className="w-full max-w-2xl bg-gray-800 p-8 rounded-2xl shadow-xl border-t-4 border-green-500 text-center my-8">
                            <h2 className="text-3xl font-bold mb-4 text-white">¡Bienvenido! 👋</h2>
                            <p className="text-gray-300 mb-6 text-lg">
                                Para comenzar a ordenar tus finanzas, necesitas agregar tu primera tarjeta o cuenta.
                            </p>
                            <button
                                onClick={() => setMostrarFormularioTarjeta(true)}
                                className="bg-green-600 text-white font-bold py-3 px-8 rounded-full hover:bg-green-700 transition transform hover:scale-105 shadow-lg"
                            >
                                + Agregar mi primera tarjeta
                            </button>
                        </div>
                    )}

                    {esVistaGastosDiarios && (
                        <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full max-w-sm sm:max-w-md mb-8 mt-8 border-t-4 border-emerald-500">
                            <h2 className="text-xl font-semibold mb-4 text-gray-300">Registrar Gasto Hormiga 🐜</h2>
                            <form onSubmit={(e) => {
                                e.preventDefault();
                                if (!nuevoItem.monto || !nuevoItem.descripcion) return;

                                const nuevoGasto = {
                                    descripcion: nuevoItem.descripcion,
                                    montoTotal: parseFloat(nuevoItem.monto),
                                    montoCuota: parseFloat(nuevoItem.monto), // En diario, el total es la cuota
                                    categoria: nuevoItem.categoria,
                                    fecha: new Date().toISOString().split('T')[0], // Guardamos la fecha de hoy
                                    cuotas: 1,
                                    cuotasRestantes: 0,
                                    pagada: true // Se considera pagado al instante
                                };

                                const nuevosGastos = [nuevoGasto, ...gastosDiarios]; // Agregamos al principio
                                setGastosDiarios(nuevosGastos);
                                saveToFirebase({ gastosDiarios: nuevosGastos });
                                setNuevoItem({ descripcion: '', monto: '', cuotas: '', categoria: categoriasDisponibles[0] });
                            }} className="flex flex-col gap-4">

                                <input type="text" placeholder="¿En qué gastaste?" value={nuevoItem.descripcion} onChange={(e) => setNuevoItem({ ...nuevoItem, descripcion: e.target.value })} className="p-3 rounded-xl bg-gray-700 text-white border border-gray-600 focus:ring-emerald-500" required />

                                <input type="number" placeholder="Monto ($)" value={nuevoItem.monto} onChange={(e) => setNuevoItem({ ...nuevoItem, monto: e.target.value })} className="p-3 rounded-xl bg-gray-700 text-white border border-gray-600 focus:ring-emerald-500" required />

                                <select value={nuevoItem.categoria} onChange={(e) => setNuevoItem({ ...nuevoItem, categoria: e.target.value })} className="p-3 rounded-xl bg-gray-700 text-white border border-gray-600 focus:ring-emerald-500">
                                    {categoriasDisponibles.map(cat => (<option key={cat} value={cat}>{cat}</option>))}
                                </select>

                                <button type="submit" className="bg-emerald-600 text-white font-bold p-3 rounded-xl hover:bg-emerald-700 transition shadow-md">
                                    Registrar Gasto
                                </button>
                            </form>
                        </div>
                    )}

                    {!esVistaGeneral && !esVistaGastosDiarios && (
                        <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full max-w-sm sm:max-w-md mb-8">
                            <h2 className="text-xl sm:text-2xl font-semibold mb-4 text-gray-300">
                                {itemEnEdicion !== null ? 'Editar' : 'Añadir'} {esVistaDeudas ? 'Deuda' : 'Compra'}
                            </h2>
                            <form onSubmit={guardarItem} className="flex flex-col gap-4">
                                <input type="text" placeholder="Descripción" value={nuevoItem.descripcion} onChange={(e) => setNuevoItem({ ...nuevoItem, descripcion: e.target.value })} className="p-3 rounded-xl bg-gray-700 text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500 transition" required />
                                <input type="number" placeholder="Monto total" value={nuevoItem.monto} onChange={(e) => setNuevoItem({ ...nuevoItem, monto: e.target.value })} className="p-3 rounded-xl bg-gray-700 text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500 transition" required />
                                <input type="number" placeholder="Número de cuotas (ej: 6)" value={nuevoItem.cuotas} onChange={(e) => setNuevoItem({ ...nuevoItem, cuotas: e.target.value })} className="p-3 rounded-xl bg-gray-700 text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500 transition" />
                                <input type="number" placeholder="Cuotas ya pagadas (ej: 2)" value={cuotasPagadas} onChange={(e) => setCuotasPagadas(e.target.value)} className="p-3 rounded-xl bg-gray-700 text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500 transition" />
                                <select value={nuevoItem.categoria} onChange={(e) => setNuevoItem({ ...nuevoItem, categoria: e.target.value })} className="p-3 rounded-xl bg-gray-700 text-white w-full border border-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500 transition">
                                    {categoriasDisponibles.map(cat => (<option key={cat} value={cat}>{cat}</option>))}
                                </select>
                                <div className="flex items-center gap-2 text-gray-300">
                                    <input type="checkbox" id="postergada-checkbox" checked={postergada} onChange={(e) => setPostergada(e.target.checked)} className="h-4 w-4 rounded bg-gray-700 border-gray-600 text-teal-500 focus:ring-teal-500" />
                                    <label htmlFor="postergada-checkbox">Pagar en el próximo resumen</label>
                                </div>
                                <button type="submit" className="bg-teal-600 text-white font-bold p-3 rounded-xl hover:bg-teal-700 transition duration-300 ease-in-out shadow-md">
                                    {itemEnEdicion !== null ? 'Guardar Cambios' : `Añadir ${esVistaDeudas ? 'Deuda' : 'Compra'}`}
                                </button>
                            </form>
                        </div>
                    )}
                    <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full max-w-sm sm:max-w-md mt-8 border-t-4 border-teal-500">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-xl sm:text-2xl font-semibold text-gray-300">
                                {verHistorial ? `Historial (${seleccion})` : `Pendientes (${seleccion})`}
                            </h2>
                        </div>

                        {/* BOTONES DE PESTAÑAS */}
                        <div className="flex bg-gray-700 p-1 rounded-xl mb-6">
                            <button
                                onClick={() => setVerHistorial(false)}
                                className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${!verHistorial
                                    ? 'bg-teal-600 text-white shadow-md'
                                    : 'text-gray-400 hover:text-white'
                                    }`}
                            >
                                Pendientes
                            </button>
                            <button
                                onClick={() => setVerHistorial(true)}
                                className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${verHistorial
                                    ? 'bg-teal-600 text-white shadow-md'
                                    : 'text-gray-400 hover:text-white'
                                    }`}
                            >
                                Historial Pagado
                            </button>
                        </div>

                        {itemsVisualizados.length > 0 ? (
                            <ul className="space-y-4">
                                {itemsVisualizados.map((item, index) => {
                                    const realIndex = itemsActivos.indexOf(item);

                                    return (
                                        <li key={index} className={`flex flex-col sm:flex-row justify-between items-start sm:items-center bg-gray-700 p-4 rounded-xl border border-gray-600 gap-3 ${verHistorial ? 'opacity-75' : ''}`}>
                                            <div>
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <p className="font-bold text-lg">{item.descripcion}</p>
                                                    {item.pagada && <span className="text-xs font-bold text-white bg-green-600 px-2 py-1 rounded-full">PAGADA</span>}
                                                    {item.postergada && <span className="text-xs font-bold text-black bg-yellow-400 px-2 py-1 rounded-full">POSTERGADA</span>}
                                                </div>
                                                <p className="text-sm text-gray-400">{item.categoria}</p>
                                                <p className="text-base text-gray-200">Total: $ {item.montoTotal.toLocaleString('es-AR')} ({item.cuotas} cuotas)</p>
                                                <p className="text-base text-cyan-400">Valor cuota: $ {item.montoCuota.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                                <p className="text-sm text-gray-400 italic mt-1">Cuotas restantes: {item.cuotasRestantes}</p>
                                            </div>
                                            <div className="flex flex-row sm:flex-col space-x-2 sm:space-x-0 sm:space-y-2 w-full sm:w-auto justify-end">
                                                {!verHistorial && item.cuotasRestantes > 0 && (
                                                    <button onClick={() => handlePagarCuota(realIndex)} className="bg-green-600 p-2 rounded-xl hover:bg-green-700 text-sm transition font-medium">Pagar Cuota</button>
                                                )}

                                                <button onClick={() => iniciarEdicion(realIndex)} className="bg-yellow-500 p-2 rounded-xl hover:bg-yellow-600 text-sm transition font-medium disabled:opacity-50" disabled={item.pagada && !verHistorial}>
                                                    {verHistorial ? 'Ver/Editar' : 'Editar'}
                                                </button>
                                                <button onClick={() => eliminarItem(realIndex)} className="bg-red-600 p-2 rounded-xl hover:bg-red-700 text-sm transition font-medium">Eliminar</button>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        ) : (
                            <div className="text-center py-8">
                                <p className="text-gray-500 text-lg italic">
                                    {verHistorial
                                        ? "No tienes compras pagadas en el historial."
                                        : "¡Todo limpio! No hay deudas pendientes."}
                                </p>
                            </div>
                        )}
                    </div>
                </>
            )}
        </main>
    );
}

export default function HomePage() {
    return <AuthWrapper />;
}