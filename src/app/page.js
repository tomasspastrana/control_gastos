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

// --- Datos Iniciales (Vacíos por defecto) ---
const datosIniciales = {
    tarjetas: [],
    deudas: [],
    gastosDiarios: []
};

const categoriasDisponibles = ['Préstamo', 'Servicios', 'Alimentos', 'Transporte', 'Entretenimiento', 'Indumentaria', 'Salud', 'Educación', 'Mascotas', 'Otros'];
const COLORES_GRAFICO = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#AF19FF', '#FF4560', '#00E396', '#775DD0'];

function AuthWrapper() {
    // 1. HOOKS DE ESTADO
    const [tarjetas, setTarjetas] = useState([]);
    const [deudas, setDeudas] = useState([]);
    const [gastosDiarios, setGastosDiarios] = useState([]);
    const [seleccion, setSeleccion] = useState("General");

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

    // Estados UI
    const [mostrarFormularioTarjeta, setMostrarFormularioTarjeta] = useState(false);
    const [nuevaTarjeta, setNuevaTarjeta] = useState({ nombre: '', limite: '', mostrarSaldo: true });
    const [verHistorial, setVerHistorial] = useState(false);

    // Estados Modo Argentina
    const [calcPrecioContado, setCalcPrecioContado] = useState('');
    const [calcPrecioFinanciado, setCalcPrecioFinanciado] = useState('');
    const [calcCantCuotas, setCalcCantCuotas] = useState('');
    const [calcInflacion, setCalcInflacion] = useState('4');
    const [resultadoCalc, setResultadoCalc] = useState(null);

    // 2. CONEXIÓN FIREBASE
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

    // 3. CARGA DE DATOS (BLINDADA)
    useEffect(() => {
        if (!db || !activeUserId) return;

        const loadAndMigrateData = async () => {
            setLoading(true);
            const userDocRefGeneral = doc(db, `artifacts/${appIdPath}/users/${activeUserId}/data/general`);
            const userDocRefOld = doc(db, `artifacts/${appIdPath}/users/${activeUserId}/data/tarjetas`);

            const generalSnapshot = await getDoc(userDocRefGeneral);

            if (generalSnapshot.exists()) {
                const data = generalSnapshot.data();
                // PROTECCIÓN: Si el campo no existe, usa array vacío []
                setTarjetas(data.tarjetas || []);
                setDeudas(data.deudas || []);
                setGastosDiarios(data.gastosDiarios || []);
                setSeleccion("General");
            } else {
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
        loadAndMigrateData().then(unsub => unsubscribe = unsub);
        return () => { if (unsubscribe) unsubscribe(); };
    }, [db, activeUserId, authUserId]);

    // 4. GUARDADO
    const saveToFirebase = async (data) => {
        if (activeUserId && db) {
            const userDocRef = doc(db, `artifacts/${appIdPath}/users/${activeUserId}/data/general`);
            try {
                await setDoc(userDocRef, { tarjetas, deudas, gastosDiarios, ...data }, { merge: true });
            } catch (e) { console.error(e); }
        }
    };

    // 5. LÓGICA DE SELECCIÓN (BLINDADA CON || [])
    const { esVistaGeneral, esVistaDeudas, esVistaGastosDiarios, tarjetaActiva, itemsActivos } = useMemo(() => {
        const esGeneral = seleccion === 'General';
        const esDeudas = seleccion === 'Deudas';
        const esGastosDiarios = seleccion === 'GastosDiarios';

        let items = [];
        let tarjeta = null;

        if (esGeneral) {
            // Protección extrema: (tarjetas || [])
            const comprasTarjetas = (tarjetas || []).flatMap(t => t.compras || []);
            // Filtramos gastos diarios para no mezclarlos en la lista general si no quieres, 
            // pero aquí los juntamos. Si prefieres separarlos, quita ...gastosDiarios
            items = [...comprasTarjetas, ...(deudas || [])];
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

    // Resúmenes (Blindados)
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

    // Filtro Visual (Blindado)
    const itemsVisualizados = useMemo(() => {
        return (itemsActivos || []).filter(item => {
            if (verHistorial) return item.pagada;
            return !item.pagada;
        });
    }, [itemsActivos, verHistorial]);

    // --- GRÁFICOS (LÓGICA BLINDADA) ---

    // 1. Torta (Categorías)
    const datosGrafico = useMemo(() => {
        if (!itemsVisualizados || itemsVisualizados.length === 0) return [];
        const agrupado = itemsVisualizados.reduce((acc, item) => {
            const cat = item.categoria;
            acc[cat] = (acc[cat] || 0) + item.montoTotal;
            return acc;
        }, {});
        return Object.keys(agrupado).map((key) => ({ name: key, value: agrupado[key] })).filter(d => d.value > 0);
    }, [itemsVisualizados]);

    // 2. Barras (Proyección Cuotas)
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

    // 3. Gastos Diarios: Mes (Día a Día)
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

    // 4. Gastos Diarios: Anual
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

    // --- FUNCIONES ---
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
        if (esVistaGeneral) return;
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
        if (esVistaGeneral) return;
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
        const totalDeudaPendiente = tarjetaActiva.compras.reduce((total, compra) => total + (compra.montoCuota * compra.cuotasRestantes), 0);
        const tarjetasActualizadas = tarjetas.map(t => t.nombre === seleccion ? { ...t, saldo: tarjetaActiva.limite - totalDeudaPendiente } : t);
        saveToFirebase({ tarjetas: tarjetasActualizadas });
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

    const handlePagarCuota = (itemIndex) => {
        if (esVistaGeneral) return;
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

    // Funciones Modo Argentina
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
        if (resumenTotalGeneral > 0 && ((valorCuota / resumenTotalGeneral) > 0.2)) {
            consejos.push("📉 Aumenta tus fijos +20%.");
            if (nivelRiesgo !== 'CRÍTICO') nivelRiesgo = 'MEDIO';
        }

        let veredicto = '';
        if (nivelRiesgo === 'CRÍTICO') veredicto = 'IMPOSIBLE';
        else if (convieneMatematicamente && nivelRiesgo === 'BAJO') veredicto = 'CUOTAS (IDEAL)';
        else if (convieneMatematicamente) veredicto = 'CUOTAS (CUIDADO)';
        else veredicto = 'CONTADO';

        setResultadoCalc({
            valorPresente: valorPresenteTotal,
            valorNominal: pFinanciado,
            valorCuotaReal: valorCuota,
            diferencia: diferenciaMatematica,
            veredicto: veredicto,
            consejos: consejos
        });
    };

    const handleCargarId = () => { if (idParaCargar.trim()) { setActiveUserId(idParaCargar.trim()); localStorage.setItem(LOCAL_STORAGE_KEY, idParaCargar.trim()); } };
    const handleResetToMyId = () => { localStorage.setItem(LOCAL_STORAGE_KEY, authUserId); setActiveUserId(authUserId); setIdParaCargar(''); };
    const handleCopyToClipboard = () => { navigator.clipboard.writeText(authUserId); setCopySuccess('¡Copiado!'); setTimeout(() => setCopySuccess(''), 2000); };

    // 6. RENDER
    if (loading) return <main className="flex min-h-screen flex-col items-center justify-center bg-gray-900 text-white"><div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-teal-500"></div></main>;

    return (
        <main className="flex min-h-screen flex-col items-center p-4 sm:p-8 md:p-12 bg-gray-900 text-white font-sans">
            <h1 className="text-3xl sm:text-4xl font-bold mb-4 sm:mb-8 text-center text-teal-400 drop-shadow-lg">Control de Gastos 💸</h1>

            {authUserId && (
                <div className="bg-gray-800 p-4 rounded-xl shadow-md w-full max-w-sm sm:max-w-md mb-8 flex flex-col items-center border-t-4 border-teal-500">
                    <p className="text-sm text-gray-400">ID de Dispositivo:</p>
                    <div className="flex items-center space-x-2 mt-1">
                        <span className="font-mono text-xs sm:text-sm bg-gray-700 p-2 rounded-md truncate max-w-[200px]">{authUserId}</span>
                        <button onClick={handleCopyToClipboard} className="bg-teal-600 p-2 rounded hover:bg-teal-700">📋</button>
                    </div>
                    {copySuccess && <p className="text-green-400 text-sm mt-2">{copySuccess}</p>}
                    <div className="w-full mt-4 flex gap-2">
                        <input type="text" placeholder="Cargar otro ID" value={idParaCargar} onChange={(e) => setIdParaCargar(e.target.value)} className="p-2 w-full rounded bg-gray-700 border border-gray-600" />
                        <button onClick={handleCargarId} className="bg-blue-600 px-3 rounded hover:bg-blue-700">Ir</button>
                        {authUserId !== activeUserId && <button onClick={handleResetToMyId} className="bg-gray-600 px-3 rounded">Mío</button>}
                    </div>
                </div>
            )}

            <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full max-w-sm sm:max-w-md mb-8 border-t-4 border-teal-500">
                <h2 className="text-xl font-semibold mb-4 text-gray-300">Seleccionar Vista</h2>
                <select value={seleccion || ''} onChange={(e) => setSeleccion(e.target.value)} className="p-3 rounded-xl bg-gray-700 text-white w-full border border-gray-600">
                    <option value="General">Resumen General (Todas)</option>
                    <option value="GastosDiarios">💰 Gastos del Día a Día</option>
                    {(tarjetas || []).map(t => <option key={t.nombre} value={t.nombre}>{t.nombre}</option>)}
                    <option value="Deudas">Deudas</option>
                </select>
                {!esVistaGeneral && !esVistaGastosDiarios && (
                    <button onClick={() => setMostrarFormularioTarjeta(true)} className="w-full mt-4 bg-green-600 text-white font-bold p-3 rounded-xl hover:bg-green-700">+ Añadir Tarjeta</button>
                )}
                {mostrarFormularioTarjeta && (
                    <form onSubmit={handleAgregarTarjeta} className="mt-4 p-4 bg-gray-700 rounded-xl flex flex-col gap-3 border-t-2 border-green-500">
                        <input type="text" placeholder="Nombre" value={nuevaTarjeta.nombre} onChange={(e) => setNuevaTarjeta({ ...nuevaTarjeta, nombre: e.target.value })} className="p-2 rounded bg-gray-600 border border-gray-500" required />
                        <input type="number" placeholder="Límite" value={nuevaTarjeta.limite} onChange={(e) => setNuevaTarjeta({ ...nuevaTarjeta, limite: e.target.value })} className="p-2 rounded bg-gray-600 border border-gray-500" required />
                        <div className="flex gap-2"><button type="submit" className="flex-1 bg-green-600 p-2 rounded">Guardar</button><button type="button" onClick={() => setMostrarFormularioTarjeta(false)} className="flex-1 bg-red-500 p-2 rounded">Cancelar</button></div>
                    </form>
                )}
            </div>

            {(tarjetas.length > 0 || deudas.length > 0 || gastosDiarios.length > 0) ? (
                <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8 mt-4">
                    {/* COLUMNA IZQUIERDA */}
                    <div className="flex flex-col gap-6">
                        {!esVistaGastosDiarios && !esVistaGeneral && !esVistaDeudas && tarjetaActiva && !tarjetaActiva.nombre.toUpperCase().includes('BBVA') && tarjetaActiva.mostrarSaldo !== false && (
                            <div className="bg-gray-800 p-6 rounded-2xl shadow-xl border-t-4 border-teal-500">
                                <div className="flex justify-between items-center"><h2 className="text-xl font-semibold text-gray-300">Saldo {tarjetaActiva.nombre}</h2><button onClick={handleRecalcularSaldo} className="bg-orange-600 px-2 py-1 rounded text-xs">Recalcular</button></div>
                                <p className="text-4xl font-extrabold text-green-400">$ {tarjetaActiva.saldo.toLocaleString('es-AR')}</p>
                            </div>
                        )}
                        {!esVistaGastosDiarios && (
                            <div className="bg-gray-800 p-6 rounded-2xl shadow-xl border-t-4 border-blue-500">
                                <h2 className="text-xl font-semibold mb-2 text-gray-300">Resumen Mes ({seleccion})</h2>
                                <p className="text-4xl font-extrabold text-blue-400">$ {resumenMes.toLocaleString('es-AR')}</p>
                                <button onClick={handlePagarResumen} disabled={resumenMes <= 0 || esVistaGeneral} className="w-full mt-4 bg-blue-600 text-white font-bold p-3 rounded-xl hover:bg-blue-700 disabled:bg-gray-500">{esVistaGeneral ? "Selecciona tarjeta para pagar" : "Pagar Resumen"}</button>
                            </div>
                        )}
                        {!esVistaGastosDiarios && !esVistaGeneral && (
                            <div className="bg-gray-800 p-6 rounded-2xl shadow-xl border-t-4 border-purple-500">
                                <h2 className="text-xl font-semibold mb-2 text-gray-300">Total Tarjetas</h2>
                                <p className="text-4xl font-extrabold text-purple-400">$ {resumenTotalGeneral.toLocaleString('es-AR')}</p>
                            </div>
                        )}
                        {!esVistaGastosDiarios && (
                            <div className="bg-gray-800 p-6 rounded-2xl shadow-xl border-t-4 border-red-500">
                                <h2 className="text-xl font-semibold mb-2 text-gray-300">Deudas</h2>
                                <p className="text-4xl font-extrabold text-red-400">$ {resumenTotalDeudas.toLocaleString('es-AR')}</p>
                            </div>
                        )}
                        {esVistaGastosDiarios && (
                            <div className="bg-gray-800 p-6 rounded-2xl shadow-xl border-t-4 border-emerald-500">
                                <h2 className="text-xl font-semibold mb-2 text-gray-300">Total Gastado (Histórico)</h2>
                                <p className="text-4xl font-extrabold text-emerald-400">$ {(itemsActivos || []).reduce((acc, item) => acc + item.montoTotal, 0).toLocaleString('es-AR')}</p>
                            </div>
                        )}

                        {/* Asesor Financiero */}
                        <div className="bg-gray-800 p-6 rounded-2xl shadow-xl border-t-4 border-sky-400">
                            <h2 className="text-xl font-semibold mb-4 text-gray-300 flex items-center gap-2">🇦🇷 Asesor IA <span className="text-xs bg-sky-900 text-sky-200 px-2 py-1 rounded-full">SMART</span></h2>
                            <div className="flex flex-col gap-3">
                                <div className="grid grid-cols-2 gap-3">
                                    <div><label className="text-xs text-gray-400">Contado</label><input type="number" value={calcPrecioContado} onChange={(e) => setCalcPrecioContado(e.target.value)} className="w-full p-2 rounded bg-gray-700 border-gray-600" /></div>
                                    <div><label className="text-xs text-gray-400 flex justify-between">Inflación <span onClick={obtenerInflacionOficial} className="cursor-pointer text-sky-400">Oficial</span></label><input type="number" value={calcInflacion} onChange={(e) => setCalcInflacion(e.target.value)} className="w-full p-2 rounded bg-gray-700 border-gray-600" /></div>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div><label className="text-xs text-gray-400 text-sky-300 font-bold">Financiado</label><input type="number" value={calcPrecioFinanciado} onChange={(e) => setCalcPrecioFinanciado(e.target.value)} className="w-full p-2 rounded bg-gray-700 border-gray-600 ring-1 ring-sky-900" /></div>
                                    <div><label className="text-xs text-gray-400">Cuotas</label><input type="number" value={calcCantCuotas} onChange={(e) => setCalcCantCuotas(e.target.value)} className="w-full p-2 rounded bg-gray-700 border-gray-600" /></div>
                                </div>
                                <button onClick={calcularInflacion} className="bg-sky-600 hover:bg-sky-700 text-white font-bold py-2 rounded mt-2">Analizar</button>
                                {resultadoCalc && (
                                    <div className={`mt-4 p-4 rounded-xl border-2 ${resultadoCalc.veredicto.includes('CUOTAS') ? 'bg-green-900/20 border-green-500' : 'bg-red-900/20 border-red-600'}`}>
                                        <p className="text-2xl font-black text-white">{resultadoCalc.veredicto}</p>
                                        <p className="text-xs text-gray-300 mt-1">Costo Real: $ {resultadoCalc.valorPresente.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</p>
                                        {resultadoCalc.consejos.map((c, i) => <p key={i} className="text-xs text-yellow-200 mt-1">• {c}</p>)}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* COLUMNA DERECHA */}
                    <div className="flex flex-col gap-6">
                        {!esVistaGastosDiarios && datosGrafico.length > 0 && (
                            <div className="bg-gray-800 p-6 rounded-2xl shadow-xl h-80 border-t-4 border-yellow-500 flex flex-col">
                                <h2 className="text-xl font-semibold mb-2 text-center text-gray-300">Categorías</h2>
                                <div className="flex-1"><ResponsiveContainer><PieChart><Pie data={datosGrafico} cx="50%" cy="50%" innerRadius={60} outerRadius={90} dataKey="value" paddingAngle={5}>{datosGrafico.map((e, i) => <Cell key={i} fill={COLORES_GRAFICO[i % COLORES_GRAFICO.length]} />)}</Pie><Tooltip formatter={(v) => `$${v.toLocaleString('es-AR')}`} contentStyle={{ backgroundColor: '#1f2937' }} /></PieChart></ResponsiveContainer></div>
                            </div>
                        )}
                        {!esVistaGastosDiarios && datosProyeccion.length > 0 && (
                            <div className="bg-gray-800 p-6 rounded-2xl shadow-xl h-80 border-t-4 border-cyan-500 flex flex-col">
                                <h2 className="text-xl font-semibold mb-4 text-center text-gray-300">Proyección</h2>
                                <div className="flex-1"><ResponsiveContainer><BarChart data={datosProyeccion}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" stroke="#9ca3af" /><YAxis stroke="#9ca3af" tickFormatter={(v) => `$${v / 1000}k`} /><Tooltip contentStyle={{ backgroundColor: '#1f2937' }} formatter={(v) => `$${v.toLocaleString('es-AR')}`} /><Bar dataKey="total" fill="#06b6d4" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
                            </div>
                        )}

                        {esVistaGastosDiarios && (
                            <div className="bg-gray-800 p-6 rounded-2xl shadow-xl h-80 border-t-4 border-emerald-500 flex flex-col">
                                <h2 className="text-xl font-semibold mb-4 text-center text-gray-300">Tu Mes al Día</h2>
                                <div className="flex-1"><ResponsiveContainer><BarChart data={datosGastosMes}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" stroke="#9ca3af" /><YAxis stroke="#9ca3af" tickFormatter={(v) => `$${v / 1000}k`} /><Tooltip contentStyle={{ backgroundColor: '#1f2937' }} formatter={(v) => `$${v.toLocaleString('es-AR')}`} /><Bar dataKey="monto" fill="#10b981" radius={[2, 2, 0, 0]} /></BarChart></ResponsiveContainer></div>
                            </div>
                        )}
                        {esVistaGastosDiarios && (
                            <div className="bg-gray-800 p-6 rounded-2xl shadow-xl h-80 border-t-4 border-blue-500 flex flex-col mt-6">
                                <h2 className="text-xl font-semibold mb-4 text-center text-gray-300">Historial Anual</h2>
                                <div className="flex-1"><ResponsiveContainer><BarChart data={datosGastosAnual}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" stroke="#9ca3af" /><YAxis stroke="#9ca3af" tickFormatter={(v) => `$${v / 1000}k`} /><Tooltip contentStyle={{ backgroundColor: '#1f2937' }} formatter={(v) => `$${v.toLocaleString('es-AR')}`} /><Bar dataKey="total" fill="#3b82f6" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                <div className="w-full max-w-2xl bg-gray-800 p-8 rounded-2xl shadow-xl border-t-4 border-green-500 text-center my-8">
                    <h2 className="text-3xl font-bold mb-4 text-white">¡Bienvenido! 👋</h2>
                    <p className="text-gray-300 mb-6 text-lg">Para comenzar, agrega tu primera tarjeta.</p>
                    <button onClick={() => setMostrarFormularioTarjeta(true)} className="bg-green-600 text-white font-bold py-3 px-8 rounded-full hover:bg-green-700">+ Comenzar</button>
                </div>
            )}

            {/* Formularios */}
            {esVistaGastosDiarios && (
                <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full max-w-sm sm:max-w-md mb-8 mt-8 border-t-4 border-emerald-500">
                    <h2 className="text-xl font-semibold mb-4 text-gray-300">Nuevo Gasto Hormiga 🐜</h2>
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
                        <input type="text" placeholder="Descripción" value={nuevoItem.descripcion} onChange={(e) => setNuevoItem({ ...nuevoItem, descripcion: e.target.value })} className="p-3 rounded-xl bg-gray-700 text-white border border-gray-600" required />
                        <input type="number" placeholder="Monto" value={nuevoItem.monto} onChange={(e) => setNuevoItem({ ...nuevoItem, monto: e.target.value })} className="p-3 rounded-xl bg-gray-700 text-white border border-gray-600" required />
                        <select value={nuevoItem.categoria} onChange={(e) => setNuevoItem({ ...nuevoItem, categoria: e.target.value })} className="p-3 rounded-xl bg-gray-700 text-white border border-gray-600">{categoriasDisponibles.map(c => <option key={c} value={c}>{c}</option>)}</select>
                        <button type="submit" className="bg-emerald-600 text-white font-bold p-3 rounded-xl hover:bg-emerald-700">Registrar</button>
                    </form>
                </div>
            )}

            {!esVistaGeneral && !esVistaGastosDiarios && (
                <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full max-w-sm sm:max-w-md mb-8 mt-8">
                    <h2 className="text-xl font-semibold mb-4 text-gray-300">{itemEnEdicion !== null ? 'Editar' : 'Añadir'} {esVistaDeudas ? 'Deuda' : 'Compra'}</h2>
                    <form onSubmit={guardarItem} className="flex flex-col gap-4">
                        <input type="text" placeholder="Descripción" value={nuevoItem.descripcion} onChange={(e) => setNuevoItem({ ...nuevoItem, descripcion: e.target.value })} className="p-3 rounded-xl bg-gray-700 text-white border border-gray-600" required />
                        <input type="number" placeholder="Monto Total" value={nuevoItem.monto} onChange={(e) => setNuevoItem({ ...nuevoItem, monto: e.target.value })} className="p-3 rounded-xl bg-gray-700 text-white border border-gray-600" required />
                        <input type="number" placeholder="Cuotas" value={nuevoItem.cuotas} onChange={(e) => setNuevoItem({ ...nuevoItem, cuotas: e.target.value })} className="p-3 rounded-xl bg-gray-700 text-white border border-gray-600" />
                        <input type="number" placeholder="Cuotas Pagadas" value={cuotasPagadas} onChange={(e) => setCuotasPagadas(e.target.value)} className="p-3 rounded-xl bg-gray-700 text-white border border-gray-600" />
                        <select value={nuevoItem.categoria} onChange={(e) => setNuevoItem({ ...nuevoItem, categoria: e.target.value })} className="p-3 rounded-xl bg-gray-700 text-white border border-gray-600">{categoriasDisponibles.map(c => <option key={c} value={c}>{c}</option>)}</select>
                        <div className="flex items-center gap-2 text-gray-300"><input type="checkbox" checked={postergada} onChange={(e) => setPostergada(e.target.checked)} /><label>Pagar próximo mes</label></div>
                        <button type="submit" className="bg-teal-600 text-white font-bold p-3 rounded-xl hover:bg-teal-700">Guardar</button>
                    </form>
                </div>
            )}

            {/* LISTA DE ITEMS */}
            <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full max-w-sm sm:max-w-md mt-8 border-t-4 border-teal-500">
                <div className="flex bg-gray-700 p-1 rounded-xl mb-6">
                    <button onClick={() => setVerHistorial(false)} className={`flex-1 py-2 text-sm font-bold rounded-lg ${!verHistorial ? 'bg-teal-600 shadow' : 'text-gray-400'}`}>Pendientes</button>
                    <button onClick={() => setVerHistorial(true)} className={`flex-1 py-2 text-sm font-bold rounded-lg ${verHistorial ? 'bg-teal-600 shadow' : 'text-gray-400'}`}>Historial</button>
                </div>
                {(itemsVisualizados || []).length > 0 ? (
                    <ul className="space-y-4">
                        {(itemsVisualizados || []).map((item, index) => {
                            const realIndex = (itemsActivos || []).indexOf(item);
                            return (
                                <li key={index} className="bg-gray-700 p-4 rounded-xl border border-gray-600">
                                    <div className="mb-2">
                                        <p className="font-bold text-lg">{item.descripcion}</p>
                                        <p className="text-sm text-gray-400">{item.categoria} - {item.fecha || ''}</p>
                                        <p className="text-cyan-400">$ {item.montoCuota.toLocaleString('es-AR')}</p>
                                    </div>
                                    <div className="flex gap-2 justify-end">
                                        {!verHistorial && item.cuotasRestantes > 0 && !esVistaGeneral && !esVistaGastosDiarios && <button onClick={() => handlePagarCuota(realIndex)} className="bg-green-600 px-3 py-1 rounded text-sm">Pagar</button>}
                                        {!esVistaGeneral && !esVistaGastosDiarios && <button onClick={() => iniciarEdicion(realIndex)} className="bg-yellow-500 px-3 py-1 rounded text-sm text-black">Editar</button>}
                                        {!esVistaGeneral && !esVistaGastosDiarios && <button onClick={() => eliminarItem(realIndex)} className="bg-red-600 px-3 py-1 rounded text-sm">Borrar</button>}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                ) : <p className="text-center text-gray-500">Nada por aquí.</p>}
            </div>
        </main>
    );
}

export default function HomePage() { return <AuthWrapper />; }