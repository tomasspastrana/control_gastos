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

// --- Datos Iniciales ---
const datosIniciales = {
    tarjetas: [],
    deudas: [],
    gastosDiarios: []
};

const categoriasDisponibles = ['Préstamo', 'Servicios', 'Alimentos', 'Transporte', 'Entretenimiento', 'Indumentaria', 'Salud', 'Educación', 'Mascotas', 'Otros', 'Transferencia', 'Electrodomésticos', 'Herramientas'];
const COLORES_GRAFICO = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#AF19FF', '#FF4560', '#00E396', '#775DD0'];

function AuthWrapper() {
    // 1. ESTADOS (Lógica Robusta de Page2)
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

    // Estados UI (Page 1)
    const [mostrarFormularioTarjeta, setMostrarFormularioTarjeta] = useState(false);
    const [nuevaTarjeta, setNuevaTarjeta] = useState({ nombre: '', limite: '', mostrarSaldo: true });
    const [verHistorial, setVerHistorial] = useState(false);

    // Estados Modo Argentina
    const [calcPrecioContado, setCalcPrecioContado] = useState('');
    const [calcPrecioFinanciado, setCalcPrecioFinanciado] = useState('');
    const [calcCantCuotas, setCalcCantCuotas] = useState('');
    const [calcInflacion, setCalcInflacion] = useState('4');
    const [resultadoCalc, setResultadoCalc] = useState(null);

    // 2. CONEXIÓN Y CARGA (Lógica Robusta de Page2)
    useEffect(() => {
        if (!firebaseConfig.apiKey) {
            setLoading(false);
            return;
        }
        try {
            const app = initializeApp(firebaseConfig);
            const auth = getAuth(app);
            const firestore = getFirestore(app);
            setDb(firestore);

            const signInUser = async () => {
                if (initialAuthToken) await signInWithCustomToken(auth, initialAuthToken);
                else await signInAnonymously(auth);
            };
            signInUser();

            const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
                if (user) {
                    setAuthUserId(user.uid);
                    const savedId = localStorage.getItem(LOCAL_STORAGE_KEY);
                    setActiveUserId(savedId || user.uid);
                    if (!savedId) localStorage.setItem(LOCAL_STORAGE_KEY, user.uid);
                } else {
                    setAuthUserId(null);
                    setActiveUserId(null);
                }
            });
            return () => unsubscribeAuth();
        } catch (error) {
            console.error(error);
            setLoading(false);
        }
    }, []);

    // Carga de Datos Blindada (Evita pantalla blanca)
    useEffect(() => {
        if (!db || !activeUserId) return;

        const loadAndMigrateData = async () => {
            setLoading(true);
            const userDocRefGeneral = doc(db, `artifacts/${appIdPath}/users/${activeUserId}/data/general`);
            const userDocRefOld = doc(db, `artifacts/${appIdPath}/users/${activeUserId}/data/tarjetas`); // Compatibilidad

            const generalSnapshot = await getDoc(userDocRefGeneral);

            if (generalSnapshot.exists()) {
                const data = generalSnapshot.data();
                // AQUÍ ESTÁ LA MAGIA: || [] evita errores si faltan campos
                setTarjetas(data.tarjetas || []);
                setDeudas(data.deudas || []);
                setGastosDiarios(data.gastosDiarios || []);
                setSeleccion("General");
            } else {
                // Intento de migración de datos viejos
                const oldSnapshot = await getDoc(userDocRefOld);
                if (oldSnapshot.exists()) {
                    const oldData = oldSnapshot.data();
                    const migratedData = {
                        tarjetas: oldData.tarjetas || [],
                        deudas: [],
                        gastosDiarios: []
                    };
                    await setDoc(userDocRefGeneral, migratedData);
                    setTarjetas(migratedData.tarjetas);
                    setDeudas(migratedData.deudas);
                    setGastosDiarios([]);
                    setSeleccion("General");
                } else {
                    if (activeUserId === authUserId) {
                        await setDoc(userDocRefGeneral, datosIniciales);
                        setTarjetas(datosIniciales.tarjetas);
                        setDeudas(datosIniciales.deudas);
                        setGastosDiarios([]);
                    }
                    setSeleccion("General");
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
        loadAndMigrateData().then(unsub => unsubscribe = unsub);
        return () => { if (unsubscribe) unsubscribe(); };
    }, [db, activeUserId, authUserId]);

    const saveToFirebase = async (data) => {
        if (activeUserId && db) {
            const userDocRef = doc(db, `artifacts/${appIdPath}/users/${activeUserId}/data/general`);
            try {
                await setDoc(userDocRef, { tarjetas, deudas, gastosDiarios, ...data }, { merge: true });
            } catch (e) { console.error(e); }
        }
    };

    // 3. LÓGICA DE SELECCIÓN (CORE)
    const { esVistaGeneral, esVistaDeudas, esVistaGastosDiarios, tarjetaActiva, itemsActivos } = useMemo(() => {
        const esGeneral = seleccion === 'General';
        const esDeudas = seleccion === 'Deudas';
        const esGastosDiarios = seleccion === 'Gastos Diarios' || seleccion === 'GastosDiarios';

        let items = [];
        let tarjeta = null;

        if (esGeneral) {
            // Protección: (tarjetas || [])
            const comprasTarjetas = (tarjetas || []).flatMap(t => t.compras || []);
            // En Page 1 no mezclábamos deudas en general, mantenemos eso para la UI limpia
            // Pero usamos la protección de Page 2
            items = [...comprasTarjetas];
        } else if (esDeudas) {
            items = deudas || [];
        } else if (esGastosDiarios) {
            items = gastosDiarios || [];
        } else {
            tarjeta = (tarjetas || []).find(t => t.nombre === seleccion);
            items = tarjeta?.compras || [];
        }

        return {
            esVistaGeneral: esGeneral,
            esVistaDeudas: esDeudas,
            esVistaGastosDiarios: esGastosDiarios,
            tarjetaActiva: tarjeta,
            itemsActivos: items
        };
    }, [seleccion, tarjetas, deudas, gastosDiarios]);

    // Resúmenes (Con protección)
    const resumenMes = useMemo(() => {
        return (itemsActivos || []).reduce((total, item) => {
            if (item.cuotasRestantes > 0 && !item.postergada) return total + parseFloat(item.montoCuota);
            return total;
        }, 0);
    }, [itemsActivos]);

    const resumenTotalGeneral = useMemo(() => {
        const calcularTotalMes = (items) => (items || []).reduce((total, item) => {
            if (item.cuotasRestantes > 0 && !item.postergada) return total + parseFloat(item.montoCuota);
            return total;
        }, 0);
        return (tarjetas || []).reduce((total, tarjeta) => total + calcularTotalMes(tarjeta.compras), 0);
    }, [tarjetas]);

    const resumenTotalDeudas = useMemo(() => {
        return (deudas || []).reduce((total, item) => {
            if (item.cuotasRestantes > 0 && !item.postergada) return total + parseFloat(item.montoCuota);
            return total;
        }, 0);
    }, [deudas]);

    // Filtro Visual (Pendientes vs Historial)
    const itemsVisualizados = useMemo(() => {
        return (itemsActivos || []).filter(item => {
            if (verHistorial) return item.pagada;
            return !item.pagada;
        });
    }, [itemsActivos, verHistorial]);

    // --- GRÁFICOS (Lógica Page 1 adaptada con seguridad Page 2) ---
    const datosGrafico = useMemo(() => {
        if (!itemsVisualizados || itemsVisualizados.length === 0) return [];
        const agrupado = itemsVisualizados.reduce((acc, item) => {
            const cat = item.categoria;
            acc[cat] = (acc[cat] || 0) + item.montoTotal;
            return acc;
        }, {});
        return Object.keys(agrupado).map((key) => ({ name: key, value: agrupado[key] })).filter(d => d.value > 0);
    }, [itemsVisualizados]);

    const datosProyeccion = useMemo(() => {
        if (!itemsVisualizados || itemsVisualizados.length === 0) return [];
        const meses = {};
        for (let i = 1; i <= 12; i++) meses[`Mes ${i}`] = 0;

        itemsVisualizados.forEach(item => {
            if (!item.pagada && item.cuotasRestantes > 0) {
                const inicio = item.postergada ? 1 : 0;
                for (let i = 0; i < item.cuotasRestantes; i++) {
                    const numeroMes = inicio + i + 1;
                    if (numeroMes <= 12) meses[`Mes ${numeroMes}`] += item.montoCuota;
                }
            }
        });
        let data = Object.keys(meses).map(key => ({ name: key, total: meses[key] }));
        let ultimoMesConDatos = 0;
        data.forEach((d, index) => { if (d.total > 1) ultimoMesConDatos = index; });
        return data.slice(0, Math.max(3, ultimoMesConDatos + 1));
    }, [itemsVisualizados]);

    const datosGastosMes = useMemo(() => {
        if (!esVistaGastosDiarios) return [];
        const hoy = new Date();
        const mesActual = hoy.getMonth();
        const anioActual = hoy.getFullYear();
        const diaActual = hoy.getDate();
        const datosDelMes = [];

        for (let i = 1; i <= diaActual; i++) {
            datosDelMes.push({ dia: i, label: `${i}`, monto: 0 });
        }

        (gastosDiarios || []).forEach(g => {
            if (!g.fecha) return;
            const [y, m, d] = g.fecha.split('-').map(Number);
            if (y === anioActual && (m - 1) === mesActual && d <= diaActual) {
                datosDelMes[d - 1].monto += g.montoTotal;
            }
        });
        return datosDelMes;
    }, [gastosDiarios, esVistaGastosDiarios]);

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


    // 4. FUNCIONES DE ACCIÓN (BLINDADAS)
    const handleAgregarTarjeta = (e) => {
        e.preventDefault();
        if (!nuevaTarjeta.nombre || parseFloat(nuevaTarjeta.limite) <= 0) return;
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

    const guardarItem = (e) => {
        e.preventDefault();
        // Validación básica
        if (!nuevoItem.monto || !nuevoItem.descripcion) return;

        const montoNum = parseFloat(nuevoItem.monto);
        const cuotasNum = (Number.isInteger(parseInt(nuevoItem.cuotas)) && nuevoItem.cuotas > 0) ? parseInt(nuevoItem.cuotas) : 1;
        const cuotasPagadasNum = parseInt(cuotasPagadas) || 0;
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
            fecha: new Date().toISOString().split('T')[0] // Agregamos fecha
        };

        if (esVistaDeudas) {
            let deudasActualizadas;
            if (itemEnEdicion !== null) deudasActualizadas = deudas.map((d, i) => i === itemEnEdicion ? itemFinal : d);
            else deudasActualizadas = [...deudas, itemFinal];
            saveToFirebase({ deudas: deudasActualizadas });
        } else if (tarjetaActiva) {
            const tarjetasActualizadas = tarjetas.map(t => {
                if (t.nombre === seleccion) {
                    let saldoActualizado = t.saldo;
                    let comprasActualizadas;
                    if (itemEnEdicion !== null) {
                        const compraOriginal = t.compras[itemEnEdicion];
                        // Restauramos saldo original antes de restar el nuevo
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

    // Funciones críticas: Se bloquean si es Vista General
    const eliminarItem = (itemIndex) => {
        if (esVistaGeneral) return; // SEGURIDAD
        if (esVistaDeudas) {
            const deudasActualizadas = deudas.filter((_, i) => i !== itemIndex);
            saveToFirebase({ deudas: deudasActualizadas });
        } else if (tarjetaActiva) {
            const itemAEliminar = tarjetaActiva.compras[itemIndex];
            if (!itemAEliminar) return;
            const montoADevolver = itemAEliminar.montoTotal;
            const tarjetasActualizadas = tarjetas.map(t =>
                t.nombre === seleccion ? { ...t, saldo: t.saldo + montoADevolver, compras: t.compras.filter((_, i) => i !== itemIndex) } : t
            );
            saveToFirebase({ tarjetas: tarjetasActualizadas });
        }
    };

    const iniciarEdicion = (itemIndex) => {
        if (esVistaGeneral) return; // SEGURIDAD
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

    const handlePagarCuota = (itemIndex) => {
        if (esVistaGeneral) return; // SEGURIDAD
        const item = itemsActivos[itemIndex];
        if (!item || item.cuotasRestantes <= 0) return;

        const actualizarItem = (c, i) => {
            if (i === itemIndex) {
                const nr = c.cuotasRestantes - 1;
                return { ...c, cuotasRestantes: nr, pagada: nr === 0 };
            }
            return c;
        };
        if (esVistaDeudas) {
            saveToFirebase({ deudas: deudas.map(actualizarItem) });
        } else if (tarjetaActiva) {
            const tarjetasActualizadas = tarjetas.map(t => {
                if (t.nombre === seleccion) {
                    return { ...t, saldo: Math.min(t.limite, t.saldo + item.montoCuota), compras: t.compras.map(actualizarItem) };
                }
                return t;
            });
            saveToFirebase({ tarjetas: tarjetasActualizadas });
        }
    };

    const handlePagarResumen = () => {
        if (resumenMes <= 0 || esVistaGeneral || esVistaGastosDiarios) return;
        const procesarItems = (items) => items.map(item => {
            let updatedItem = { ...item };
            if (updatedItem.cuotasRestantes > 0 && !updatedItem.postergada) {
                updatedItem.cuotasRestantes -= 1;
                updatedItem.pagada = updatedItem.cuotasRestantes === 0;
            }
            if (updatedItem.postergada) updatedItem.postergada = false;
            return updatedItem;
        });

        if (esVistaDeudas) {
            saveToFirebase({ deudas: procesarItems(deudas) });
        } else if (tarjetaActiva) {
            const comprasDespues = procesarItems(tarjetaActiva.compras);
            const tarjetasActualizadas = tarjetas.map(t => t.nombre === seleccion ? { ...t, saldo: Math.min(t.limite, t.saldo + resumenMes), compras: comprasDespues } : t);
            saveToFirebase({ tarjetas: tarjetasActualizadas });
        }
    };

    const handleRecalcularSaldo = () => {
        if (!tarjetaActiva) return;
        const totalDeudaPendiente = tarjetaActiva.compras.reduce((total, compra) => total + (compra.montoCuota * compra.cuotasRestantes), 0);
        const tarjetasActualizadas = tarjetas.map(t => t.nombre === seleccion ? { ...t, saldo: tarjetaActiva.limite - totalDeudaPendiente } : t);
        saveToFirebase({ tarjetas: tarjetasActualizadas });
    };

    // Funciones de utilidad UI
    const handleCargarId = () => { if (idParaCargar.trim()) { setActiveUserId(idParaCargar.trim()); localStorage.setItem(LOCAL_STORAGE_KEY, idParaCargar.trim()); } };
    const handleResetToMyId = () => { localStorage.setItem(LOCAL_STORAGE_KEY, authUserId); setActiveUserId(authUserId); setIdParaCargar(''); };
    const handleCopyToClipboard = () => {
        if (!authUserId) return;
        navigator.clipboard.writeText(authUserId).then(() => {
            setCopySuccess('¡Copiado!'); setTimeout(() => setCopySuccess(''), 2000);
        });
    };

    // Modo Argentina UI
    const obtenerInflacionOficial = async () => {
        try {
            const response = await fetch('https://api.argentinadatos.com/v1/finanzas/indices/inflacion');
            if (!response.ok) throw new Error('Error');
            const data = await response.json();
            if (data && data.length > 0) {
                const ultimoDato = data[data.length - 1];
                setCalcInflacion(ultimoDato.valor.toString());
                alert(`Dato actualizado: ${ultimoDato.valor}%`);
            }
        } catch (e) { alert("Error obteniendo inflación."); }
    };

    const calcularInflacion = (e) => {
        e.preventDefault();
        const pContado = parseFloat(calcPrecioContado);
        const pFinanciado = parseFloat(calcPrecioFinanciado);
        const cuotas = parseInt(calcCantCuotas);
        const inf = parseFloat(calcInflacion) / 100;
        if (!pContado || !pFinanciado || !cuotas) return;

        const valorCuota = pFinanciado / cuotas;
        let valorPresenteTotal = 0;
        for (let i = 1; i <= cuotas; i++) valorPresenteTotal += valorCuota / Math.pow(1 + inf, i);

        const diferenciaMatematica = pContado - valorPresenteTotal;
        const convieneMatematicamente = diferenciaMatematica > 0;

        let consejos = [];
        let nivelRiesgo = 'BAJO';

        if (tarjetaActiva) {
            if (pFinanciado > tarjetaActiva.saldo) { consejos.push("❌ Saldo insuficiente."); nivelRiesgo = 'CRÍTICO'; }
            else if ((pFinanciado / tarjetaActiva.limite) > 0.5) { consejos.push("⚠️ Consume +50% límite."); nivelRiesgo = 'ALTO'; }
        }

        let veredicto = '';
        if (nivelRiesgo === 'CRÍTICO') veredicto = 'IMPOSIBLE';
        else if (convieneMatematicamente) veredicto = 'CUOTAS (CONVIENE)';
        else veredicto = 'CONTADO (MEJOR)';

        setResultadoCalc({
            valorPresente: valorPresenteTotal,
            valorNominal: pFinanciado,
            valorCuotaReal: valorCuota,
            diferencia: diferenciaMatematica,
            veredicto: veredicto,
            consejos: consejos
        });
    };


    // 5. RENDER (EL CSS BONITO DE PAGE 1)
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
                        <button onClick={handleCopyToClipboard} className="bg-teal-600 text-white p-2 rounded-md hover:bg-teal-700 transition">📋</button>
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
                    </div>
                </div>
            )}

            <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full max-w-sm sm:max-w-md mb-8 border-t-4 border-teal-500">
                <h2 className="text-xl sm:text-2xl font-semibold mb-4 text-gray-300">Seleccionar Vista</h2>
                <select
                    value={seleccion || ''}
                    onChange={(e) => setSeleccion(e.target.value)}
                    className="p-3 rounded-xl bg-gray-700 text-white w-full border border-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500 transition"
                >
                    <option value="General">Resumen General (Todas)</option>
                    {(tarjetas || []).map(t => (<option key={t.nombre} value={t.nombre}>{t.nombre}</option>))}
                    <option value="Gastos Diarios">Gastos del Día a Día</option>
                    <option value="Deudas">Deudas</option>
                </select>
                {!esVistaGeneral && !esVistaGastosDiarios && (
                    <button
                        onClick={() => setMostrarFormularioTarjeta(true)}
                        className="w-full mt-4 bg-green-600 text-white font-bold p-3 rounded-xl hover:bg-green-700 transition"
                    >
                        + Añadir Nueva Tarjeta
                    </button>
                )}

                {mostrarFormularioTarjeta && (
                    <form onSubmit={handleAgregarTarjeta} className="mt-4 p-4 bg-gray-700 rounded-xl flex flex-col gap-3 border-t-2 border-green-500">
                        <h3 className="text-lg font-semibold text-gray-300">Nueva Tarjeta</h3>
                        <input type="text" placeholder="Nombre" value={nuevaTarjeta.nombre} onChange={(e) => setNuevaTarjeta({ ...nuevaTarjeta, nombre: e.target.value })} className="p-2 rounded-md bg-gray-600 text-white border border-gray-500 focus:ring-green-500" required />
                        <input type="number" placeholder="Límite" value={nuevaTarjeta.limite} onChange={(e) => setNuevaTarjeta({ ...nuevaTarjeta, limite: e.target.value })} className="p-2 rounded-md bg-gray-600 text-white border border-gray-500 focus:ring-green-500" required />
                        <div className="flex items-center gap-2 text-gray-300 mt-2">
                            <input type="checkbox" checked={nuevaTarjeta.mostrarSaldo} onChange={(e) => setNuevaTarjeta({ ...nuevaTarjeta, mostrarSaldo: e.target.checked })} />
                            <label>Mostrar saldo</label>
                        </div>
                        <div className="flex gap-2 mt-2">
                            <button type="submit" className="flex-1 bg-green-600 text-white p-2 rounded-md hover:bg-green-700 font-semibold transition">Guardar</button>
                            <button type="button" onClick={() => setMostrarFormularioTarjeta(false)} className="flex-1 bg-red-500 text-white p-2 rounded-md hover:bg-red-600">Cancelar</button>
                        </div>
                    </form>
                )}
            </div>

            {/* CONTENEDOR PRINCIPAL */}
            {((tarjetas || []).length > 0 || (deudas || []).length > 0 || (gastosDiarios || []).length > 0) ? (
                <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8 mt-4">
                    {/* COLUMNA IZQUIERDA: RESÚMENES */}
                    <div className="flex flex-col gap-6">

                        {/* SALDO (Solo en tarjeta específica) */}
                        {!esVistaGastosDiarios && !esVistaGeneral && !esVistaDeudas && tarjetaActiva && tarjetaActiva.mostrarSaldo !== false && (
                            <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full border-t-4 border-teal-500">
                                <div className="flex justify-between items-center mb-2">
                                    <h2 className="text-xl font-semibold text-gray-300">Saldo de {tarjetaActiva.nombre}</h2>
                                    <button onClick={handleRecalcularSaldo} title="Recalcular saldo" className="bg-orange-600 text-white px-3 py-1 text-xs font-bold rounded-lg hover:bg-orange-700 transition">Recalcular</button>
                                </div>
                                <p className="text-4xl font-extrabold text-green-400">$ {tarjetaActiva.saldo.toLocaleString('es-AR')}</p>
                                <p className="text-lg text-gray-400 mt-1">Límite: $ {tarjetaActiva.limite.toLocaleString('es-AR')}</p>
                            </div>
                        )}

                        {/* RESUMEN MES (Oculto en Gastos Diarios) */}
                        {!esVistaGastosDiarios && (
                            <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full border-t-4 border-blue-500">
                                <h2 className="text-xl font-semibold mb-2 text-gray-300">Resumen del Mes ({seleccion})</h2>
                                <p className="text-4xl font-extrabold text-blue-400">$ {resumenMes.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                <button onClick={handlePagarResumen} disabled={resumenMes <= 0 || esVistaGeneral} className="w-full mt-4 bg-blue-600 text-white font-bold p-3 rounded-xl hover:bg-blue-700 transition duration-300 ease-in-out shadow-md disabled:bg-gray-500 disabled:cursor-not-allowed">
                                    {esVistaGeneral ? "Selecciona una tarjeta para pagar" : "Pagar Resumen"}
                                </button>
                            </div>
                        )}

                        {/* TOTAL TARJETAS (Oculto en Gastos Diarios y General) */}
                        {!esVistaGastosDiarios && !esVistaGeneral && (
                            <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full border-t-4 border-purple-500">
                                <h2 className="text-xl font-semibold mb-2 text-gray-300">Resumen Total De Tarjetas</h2>
                                <p className="text-4xl font-extrabold text-purple-400">$ {resumenTotalGeneral.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                            </div>
                        )}

                        {/* RESUMEN DEUDAS */}
                        {!esVistaGastosDiarios && (
                            <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full border-t-4 border-red-500">
                                <h2 className="text-xl font-semibold mb-2 text-gray-300">Resumen Mensual de Deudas</h2>
                                <p className="text-4xl font-extrabold text-red-400">$ {resumenTotalDeudas.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                            </div>
                        )}

                        {/* ASESOR IA (MODO ARGENTINA) */}
                        <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full border-t-4 border-sky-400">
                            <h2 className="text-xl font-semibold mb-4 text-gray-300 flex items-center gap-2">
                                🇦🇷 Asesor IA <span className="text-xs bg-sky-900 text-sky-200 px-2 py-1 rounded-full">SMART</span>
                            </h2>
                            <div className="flex flex-col gap-3">
                                <div className="grid grid-cols-2 gap-3">
                                    <div><label className="text-xs text-gray-400">Contado</label><input type="number" value={calcPrecioContado} onChange={(e) => setCalcPrecioContado(e.target.value)} className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:ring-sky-500" placeholder="$" /></div>
                                    <div><label className="text-xs text-gray-400 flex justify-between">Inflación <span onClick={obtenerInflacionOficial} className="cursor-pointer text-sky-400">Oficial</span></label><input type="number" value={calcInflacion} onChange={(e) => setCalcInflacion(e.target.value)} className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:ring-sky-500" placeholder="%" /></div>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div><label className="text-xs text-gray-400 text-sky-300 font-bold">Financiado</label><input type="number" value={calcPrecioFinanciado} onChange={(e) => setCalcPrecioFinanciado(e.target.value)} className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 ring-1 ring-sky-900 focus:ring-sky-500" placeholder="$" /></div>
                                    <div><label className="text-xs text-gray-400">Cuotas</label><input type="number" value={calcCantCuotas} onChange={(e) => setCalcCantCuotas(e.target.value)} className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:ring-sky-500" placeholder="#" /></div>
                                </div>
                                <button onClick={calcularInflacion} className="bg-gradient-to-r from-sky-600 to-blue-700 hover:from-sky-700 hover:to-blue-800 text-white font-bold py-2 rounded transition mt-2 shadow-lg">Analizar Compra</button>
                                {resultadoCalc && (
                                    <div className={`mt-4 p-4 rounded-xl border-2 ${resultadoCalc.veredicto.includes('CUOTAS') ? 'bg-green-900/20 border-green-500' : 'bg-red-900/20 border-red-600'}`}>
                                        <p className="text-2xl font-black text-white">{resultadoCalc.veredicto}</p>
                                        <div className="bg-gray-800/50 p-2 rounded mt-2 text-xs flex justify-between">
                                            <span>Dif: <span className={resultadoCalc.diferencia > 0 ? "text-green-400" : "text-red-400"}>$ {Math.abs(resultadoCalc.diferencia).toFixed(0)}</span></span>
                                            <span>Real: <span className="text-white">$ {resultadoCalc.valorPresente.toFixed(0)}</span></span>
                                        </div>
                                        {resultadoCalc.consejos.map((c, i) => <p key={i} className="text-xs text-yellow-200 mt-1">• {c}</p>)}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* COLUMNA DERECHA: GRÁFICOS */}
                    <div className="flex flex-col gap-6">
                        {/* GRÁFICO TORTA */}
                        {!esVistaGastosDiarios && datosGrafico.length > 0 && (
                            <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full h-80 border-t-4 border-yellow-500 flex flex-col justify-center">
                                <h2 className="text-xl font-semibold mb-2 text-gray-300 text-center">Distribución</h2>
                                <div className="h-full w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie data={datosGrafico} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={5} dataKey="value">
                                                {datosGrafico.map((entry, index) => (<Cell key={`cell-${index}`} fill={COLORES_GRAFICO[index % COLORES_GRAFICO.length]} />))}
                                            </Pie>
                                            <Tooltip formatter={(value) => `$${value.toLocaleString('es-AR')}`} contentStyle={{ backgroundColor: '#1f2937', borderRadius: '8px' }} />
                                            <Legend iconType="circle" verticalAlign="bottom" height={36} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        )}

                        {/* GRÁFICO BARRAS */}
                        {!esVistaGastosDiarios && datosProyeccion.length > 0 && (
                            <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full h-80 border-t-4 border-cyan-500 flex flex-col justify-center">
                                <h2 className="text-xl font-semibold mb-4 text-gray-300 text-center">Proyección</h2>
                                <div className="h-full w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={datosProyeccion} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                                            <XAxis dataKey="name" stroke="#9ca3af" tick={{ fill: '#9ca3af', fontSize: 12 }} axisLine={false} tickLine={false} />
                                            <YAxis stroke="#9ca3af" tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(value) => `$${value / 1000}k`} />
                                            <Tooltip formatter={(value) => [`$${value.toLocaleString('es-AR')}`, 'A pagar']} contentStyle={{ backgroundColor: '#1f2937', borderRadius: '8px' }} />
                                            <Bar dataKey="total" fill="#06b6d4" radius={[4, 4, 0, 0]} barSize={30} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        )}

                        {/* GRÁFICOS GASTOS DIARIOS */}
                        {esVistaGastosDiarios && (
                            <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full h-80 border-t-4 border-emerald-500 flex flex-col justify-center">
                                <h2 className="text-xl font-semibold mb-4 text-gray-300 text-center">Tu Mes al Día</h2>
                                <div className="h-full w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={datosGastosMes}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                                            <XAxis dataKey="label" stroke="#9ca3af" />
                                            <YAxis stroke="#9ca3af" tickFormatter={(v) => `$${v / 1000}k`} />
                                            <Tooltip contentStyle={{ backgroundColor: '#1f2937' }} formatter={(value) => [`$${value.toLocaleString('es-AR')}`, 'Gastado']} />
                                            <Bar dataKey="monto" fill="#10b981" radius={[2, 2, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        )}
                        {esVistaGastosDiarios && (
                            <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full h-80 border-t-4 border-blue-500 flex flex-col justify-center mt-6">
                                <h2 className="text-xl font-semibold mb-4 text-gray-300 text-center">Historial Anual</h2>
                                <div className="h-full w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={datosGastosAnual}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                                            <XAxis dataKey="name" stroke="#9ca3af" />
                                            <YAxis stroke="#9ca3af" tickFormatter={(v) => `$${v / 1000}k`} />
                                            <Tooltip contentStyle={{ backgroundColor: '#1f2937' }} formatter={(value) => [`$${value.toLocaleString('es-AR')}`, 'Total']} />
                                            <Bar dataKey="total" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                <div className="w-full max-w-2xl bg-gray-800 p-8 rounded-2xl shadow-xl border-t-4 border-green-500 text-center my-8">
                    <h2 className="text-3xl font-bold mb-4 text-white">¡Bienvenido! 👋</h2>
                    <p className="text-gray-300 mb-6 text-lg">Para comenzar a ordenar tus finanzas, necesitas agregar tu primera tarjeta o cuenta.</p>
                    <button onClick={() => setMostrarFormularioTarjeta(true)} className="bg-green-600 text-white font-bold py-3 px-8 rounded-full hover:bg-green-700 transition transform hover:scale-105 shadow-lg">
                        + Agregar mi primera tarjeta
                    </button>
                </div>
            )}

            {/* FORMULARIOS REGISTRO */}
            {esVistaGastosDiarios && (
                <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full max-w-sm sm:max-w-md mb-8 mt-8 border-t-4 border-emerald-500">
                    <h2 className="text-xl font-semibold mb-4 text-gray-300">Registrar Gasto Hormiga 🐜</h2>
                    <form onSubmit={(e) => {
                        e.preventDefault();
                        if (!nuevoItem.monto || !nuevoItem.descripcion) return;
                        const nuevoGasto = {
                            descripcion: nuevoItem.descripcion,
                            montoTotal: parseFloat(nuevoItem.monto),
                            montoCuota: parseFloat(nuevoItem.monto),
                            categoria: nuevoItem.categoria,
                            fecha: new Date().toISOString().split('T')[0],
                            cuotas: 1, cuotasRestantes: 0, pagada: true
                        };
                        const nuevosGastos = [nuevoGasto, ...gastosDiarios];
                        setGastosDiarios(nuevosGastos);
                        saveToFirebase({ gastosDiarios: nuevosGastos });
                        setNuevoItem({ descripcion: '', monto: '', cuotas: '', categoria: categoriasDisponibles[0] });
                    }} className="flex flex-col gap-4">
                        <input type="text" placeholder="¿En qué gastaste?" value={nuevoItem.descripcion} onChange={(e) => setNuevoItem({ ...nuevoItem, descripcion: e.target.value })} className="p-3 rounded-xl bg-gray-700 text-white border border-gray-600 focus:ring-emerald-500" required />
                        <input type="number" placeholder="Monto ($)" value={nuevoItem.monto} onChange={(e) => setNuevoItem({ ...nuevoItem, monto: e.target.value })} className="p-3 rounded-xl bg-gray-700 text-white border border-gray-600 focus:ring-emerald-500" required />
                        <select value={nuevoItem.categoria} onChange={(e) => setNuevoItem({ ...nuevoItem, categoria: e.target.value })} className="p-3 rounded-xl bg-gray-700 text-white border border-gray-600 focus:ring-emerald-500">{categoriasDisponibles.map(cat => (<option key={cat} value={cat}>{cat}</option>))}</select>
                        <button type="submit" className="bg-emerald-600 text-white font-bold p-3 rounded-xl hover:bg-emerald-700 transition shadow-md">Registrar Gasto</button>
                    </form>
                </div>
            )}

            {!esVistaGeneral && !esVistaGastosDiarios && (
                <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full max-w-sm sm:max-w-md mb-8">
                    <h2 className="text-xl sm:text-2xl font-semibold mb-4 text-gray-300">{itemEnEdicion !== null ? 'Editar' : 'Añadir'} {esVistaDeudas ? 'Deuda' : 'Compra'}</h2>
                    <form onSubmit={guardarItem} className="flex flex-col gap-4">
                        <input type="text" placeholder="Descripción" value={nuevoItem.descripcion} onChange={(e) => setNuevoItem({ ...nuevoItem, descripcion: e.target.value })} className="p-3 rounded-xl bg-gray-700 text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500 transition" required />
                        <input type="number" placeholder="Monto total" value={nuevoItem.monto} onChange={(e) => setNuevoItem({ ...nuevoItem, monto: e.target.value })} className="p-3 rounded-xl bg-gray-700 text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500 transition" required />
                        <input type="number" placeholder="Número de cuotas (ej: 6)" value={nuevoItem.cuotas} onChange={(e) => setNuevoItem({ ...nuevoItem, cuotas: e.target.value })} className="p-3 rounded-xl bg-gray-700 text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500 transition" />
                        <input type="number" placeholder="Cuotas ya pagadas (ej: 2)" value={cuotasPagadas} onChange={(e) => setCuotasPagadas(e.target.value)} className="p-3 rounded-xl bg-gray-700 text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500 transition" />
                        <select value={nuevoItem.categoria} onChange={(e) => setNuevoItem({ ...nuevoItem, categoria: e.target.value })} className="p-3 rounded-xl bg-gray-700 text-white w-full border border-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500 transition">{categoriasDisponibles.map(cat => (<option key={cat} value={cat}>{cat}</option>))}</select>
                        <div className="flex items-center gap-2 text-gray-300">
                            <input type="checkbox" id="postergada-checkbox" checked={postergada} onChange={(e) => setPostergada(e.target.checked)} className="h-4 w-4 rounded bg-gray-700 border-gray-600 text-teal-500 focus:ring-teal-500" />
                            <label htmlFor="postergada-checkbox">Pagar en el próximo resumen</label>
                        </div>
                        <button type="submit" className="bg-teal-600 text-white font-bold p-3 rounded-xl hover:bg-teal-700 transition duration-300 ease-in-out shadow-md">{itemEnEdicion !== null ? 'Guardar Cambios' : `Añadir ${esVistaDeudas ? 'Deuda' : 'Compra'}`}</button>
                    </form>
                </div>
            )}

            {/* LISTA DE ITEMS */}
            <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full max-w-sm sm:max-w-md mt-8 border-t-4 border-teal-500">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl sm:text-2xl font-semibold text-gray-300">{verHistorial ? `Historial (${seleccion})` : `Pendientes (${seleccion})`}</h2>
                </div>
                <div className="flex bg-gray-700 p-1 rounded-xl mb-6">
                    <button onClick={() => setVerHistorial(false)} className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${!verHistorial ? 'bg-teal-600 text-white shadow-md' : 'text-gray-400 hover:text-white'}`}>Pendientes</button>
                    <button onClick={() => setVerHistorial(true)} className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${verHistorial ? 'bg-teal-600 text-white shadow-md' : 'text-gray-400 hover:text-white'}`}>Historial Pagado</button>
                </div>

                {(itemsVisualizados || []).length > 0 ? (
                    <ul className="space-y-4">
                        {(itemsVisualizados || []).map((item, index) => {
                            const realIndex = (itemsActivos || []).indexOf(item);
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
                                        {/* OCULTAMOS ACCIONES SI ESTAMOS EN VISTA GENERAL */}
                                        {!esVistaGeneral && !esVistaGastosDiarios && (
                                            <>
                                                {!verHistorial && item.cuotasRestantes > 0 && (
                                                    <button onClick={() => handlePagarCuota(realIndex)} className="bg-green-600 p-2 rounded-xl hover:bg-green-700 text-sm transition font-medium">Pagar Cuota</button>
                                                )}
                                                <button onClick={() => iniciarEdicion(realIndex)} className="bg-yellow-500 p-2 rounded-xl hover:bg-yellow-600 text-sm transition font-medium disabled:opacity-50" disabled={item.pagada && !verHistorial}>
                                                    {verHistorial ? 'Ver' : 'Editar'}
                                                </button>
                                                <button onClick={() => eliminarItem(realIndex)} className="bg-red-600 p-2 rounded-xl hover:bg-red-700 text-sm transition font-medium">Eliminar</button>
                                            </>
                                        )}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                ) : (
                    <div className="text-center py-8">
                        <p className="text-gray-500 text-lg italic">{verHistorial ? "No tienes compras pagadas en el historial." : "¡Todo limpio! No hay deudas pendientes."}</p>
                    </div>
                )}
            </div>
        </main>
    );
}

export default function HomePage() { return <AuthWrapper />; }