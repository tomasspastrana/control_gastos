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

    // ESTADOS DE PERFIL FINANCIERO
    const [perfilFinanciero, setPerfilFinanciero] = useState({ sueldo: '', gastosFijos: '', fondoEmergencia: '' });
    const [mostrarConfigPerfil, setMostrarConfigPerfil] = useState(false);


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
                setPerfilFinanciero(data.perfilFinanciero || { sueldo: '', gastosFijos: '', fondoEmergencia: '' });
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
                    setPerfilFinanciero(data.perfilFinanciero || { sueldo: '', gastosFijos: '', fondoEmergencia: '' });
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
        if (!itemsActivos) return [];

        // CASO 1: Si son GASTOS DIARIOS, mostramos TODO en una sola lista (ordenado por fecha desc)
        if (esVistaGastosDiarios) {
            return [...itemsActivos].sort((a, b) => {
                const fechaA = a.fecha ? new Date(a.fecha) : new Date(0);
                const fechaB = b.fecha ? new Date(b.fecha) : new Date(0);
                return fechaB - fechaA; // El más reciente primero
            });
        }

        // CASO 2: Si son TARJETAS o DEUDAS, respetamos las pestañas (Pendiente/Historial)
        return itemsActivos.filter(item => {
            if (verHistorial) return item.pagada;
            return !item.pagada;
        });
    }, [itemsActivos, verHistorial, esVistaGastosDiarios]);

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
    const handleEliminarTarjeta = () => {
        if (!tarjetaActiva) return;

        // Preguntar confirmación para evitar accidentes
        const confirmar = window.confirm(
            `⚠️ ¿Estás seguro de que quieres eliminar la tarjeta "${tarjetaActiva.nombre}"?\n\nSe borrarán permanentemente todas las compras e historial asociados a ella.`
        );

        if (confirmar) {
            const tarjetasActualizadas = tarjetas.filter(t => t.nombre !== tarjetaActiva.nombre);

            // Guardamos en Firebase
            saveToFirebase({ tarjetas: tarjetasActualizadas });

            // Actualizamos estado local
            setTarjetas(tarjetasActualizadas);

            // Importante: Volver a la vista General para que no intente mostrar la tarjeta borrada
            setSeleccion('General');
        }
    };

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
    const handleGuardarPerfil = (e) => {
        e.preventDefault();
        // Guardamos en Firebase (se mezcla con tarjetas y deudas existentes sin borrarlas)
        saveToFirebase({ perfilFinanciero });
        setMostrarConfigPerfil(false); // Cerramos el modal
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
        // 1. Obtener inputs básicos
        const pContado = parseFloat(calcPrecioContado);
        const pFinanciado = parseFloat(calcPrecioFinanciado);
        const cuotas = parseInt(calcCantCuotas);
        const inf = parseFloat(calcInflacion) / 100;

        // 2. Obtener datos del perfil (con valores por defecto si no existen)
        const sueldo = parseFloat(perfilFinanciero.sueldo) || 0;
        const gastos = parseFloat(perfilFinanciero.gastosFijos) || 0;
        const ahorros = parseFloat(perfilFinanciero.fondoEmergencia) || 0;
        const deudaActual = resumenTotalGeneral || 0;

        if (!pContado || !pFinanciado || !cuotas) return;

        // 3. Cálculos Matemáticos (Valor Presente)
        const valorCuota = pFinanciado / cuotas;
        let valorPresenteTotal = 0;
        for (let i = 1; i <= cuotas; i++) valorPresenteTotal += valorCuota / Math.pow(1 + inf, i);
        const diferenciaMatematica = pContado - valorPresenteTotal;
        const convieneMatematicamente = diferenciaMatematica > 0;

        // 4. ANÁLISIS FINANCIERO (El Cerebro Nuevo) 🧠
        let score = 100; // Empezamos con puntaje perfecto
        let consejos = [];
        let nivelRiesgo = 'BAJO';
        let impactoMensual = 0; // % del ingreso libre que consume esta cuota

        // A. Análisis de Capacidad
        if (sueldo > 0) {
            const ingresoDisponible = sueldo - gastos - deudaActual;
            const nuevoIngresoDisponible = ingresoDisponible - valorCuota;
            impactoMensual = (valorCuota / ingresoDisponible) * 100;
            const ratioEndeudamientoTotal = ((deudaActual + valorCuota) / sueldo) * 100;

            // Penalizaciones al Score
            if (nuevoIngresoDisponible < 0) {
                score -= 50;
                consejos.push("⛔ No tenés liquidez mensual para pagar esta cuota.");
                nivelRiesgo = 'CRÍTICO';
            } else if (nuevoIngresoDisponible < (sueldo * 0.05)) {
                score -= 30;
                consejos.push("⚠️ Quedarás con muy poco margen de maniobra mensual.");
            }

            if (ratioEndeudamientoTotal > 40) {
                score -= 25;
                consejos.push("📉 Tus cuotas totales superarían el 40% de tu sueldo.");
                nivelRiesgo = 'ALTO';
            } else if (ratioEndeudamientoTotal > 30) {
                score -= 15;
                consejos.push("👀 Tus deudas están llegando al límite saludable (30%).");
            }

            if (impactoMensual > 15) {
                score -= 10;
                consejos.push("📦 Esta sola compra ocupa mucho de tu dinero libre.");
            }
        } else {
            consejos.push("ℹ️ Cargá tu sueldo en '⚙️ Mis Datos' para un análisis de riesgo real.");
        }

        // B. Análisis de Fondo de Emergencia
        if (sueldo > 0 && ahorros < (gastos + deudaActual + valorCuota)) {
            score -= 10;
            consejos.push("🛡️ Tu fondo de emergencia es bajo para afrontar imprevistos.");
        }

        // C. Análisis de Tarjeta (Límite)
        {/*if (tarjetaActiva) {
            if (pFinanciado > tarjetaActiva.saldo) {
                score = 0;
                consejos.push("❌ Saldo insuficiente en la tarjeta seleccionada.");
                nivelRiesgo = 'IMPOSIBLE';
            } else if ((pFinanciado / tarjetaActiva.limite) > 0.5) {
                score -= 10;
                consejos.push("💳 Esta compra consume más del 50% de tu límite.");
            }
        }
        */}

        // D. Análisis Matemático (Bonificación/Penalización)
        if (convieneMatematicamente) {
            score += 10; // Suma puntos si le ganas a la inflación
            consejos.push("✅ Matemáticamente le ganás a la inflación.");
        } else {
            score -= 20;
            consejos.push("💸 Matemáticamente es más barato pagar de contado.");
        }

        // Limitar Score 0-100
        score = Math.max(0, Math.min(100, score));

        // 5. Definir Veredicto Final
        let veredictoTexto = '';
        let veredictoColor = '';

        if (nivelRiesgo === 'IMPOSIBLE') {
            veredictoTexto = 'IMPOSIBLE'; veredictoColor = 'text-gray-500';
        } else if (score >= 80) {
            veredictoTexto = '🟢 OPORTUNIDAD EXCELENTE'; veredictoColor = 'text-green-400';
        } else if (score >= 60) {
            veredictoTexto = '🟡 COMPRA ACEPTABLE'; veredictoColor = 'text-yellow-400';
        } else if (score >= 40) {
            veredictoTexto = '🟠 RIESGO MODERADO'; veredictoColor = 'text-orange-400';
        } else {
            veredictoTexto = '🔴 NO RECOMENDADO'; veredictoColor = 'text-red-500';
        }

        setResultadoCalc({
            valorPresente: valorPresenteTotal,
            valorNominal: pFinanciado,
            diferencia: diferenciaMatematica,
            valorCuotaReal: valorCuota, // Agregamos esto
            veredicto: veredictoTexto,
            veredictoColor: veredictoColor,
            score: score,
            consejos: consejos,
            impacto: impactoMensual
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
                    <>
                        <button
                            onClick={() => setMostrarFormularioTarjeta(true)}
                            className="w-full mt-4 bg-green-600 text-white font-bold p-3 rounded-xl hover:bg-green-700 transition"
                        >
                            + Añadir Nueva Tarjeta
                        </button>
                        {tarjetaActiva && (
                            <button
                                onClick={handleEliminarTarjeta}
                                className="w-full mt-4 bg-red-600 text-white font-bold p-3 rounded-xl hover:bg-red-700 transition"
                            >
                                🗑️ Eliminar {tarjetaActiva.nombre}
                            </button>
                        )}
                    </>



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
                        {/* 0. NUEVA TARJETA: MI SALUD FINANCIERA (Perfil) */}
                        <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full border-t-4 border-indigo-500">
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-xl font-semibold text-gray-300">Mi Base Mensual</h2>
                                <button
                                    onClick={() => setMostrarConfigPerfil(true)}
                                    className="bg-gray-700 hover:bg-gray-600 text-white p-2 rounded-lg text-xs font-bold transition flex items-center gap-1"
                                >
                                    ⚙️ Editar
                                </button>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                {/* Ingresos */}
                                <div className="bg-gray-700/30 p-3 rounded-xl border border-gray-700">
                                    <p className="text-xs text-gray-400 mb-1">Ingreso Neto</p>
                                    <p className="text-lg sm:text-xl font-bold text-green-400 truncate">
                                        {perfilFinanciero.sueldo ? `$ ${parseFloat(perfilFinanciero.sueldo).toLocaleString('es-AR')}` : <span className="text-gray-500 text-sm">--</span>}
                                    </p>
                                </div>

                                {/* Gastos Fijos */}
                                <div className="bg-gray-700/30 p-3 rounded-xl border border-gray-700">
                                    <p className="text-xs text-gray-400 mb-1">Gastos Fijos</p>
                                    <p className="text-lg sm:text-xl font-bold text-red-400 truncate">
                                        {perfilFinanciero.gastosFijos ? `$ ${parseFloat(perfilFinanciero.gastosFijos).toLocaleString('es-AR')}` : <span className="text-gray-500 text-sm">--</span>}
                                    </p>
                                </div>

                                {/* Fondo de Emergencia (Ocupa todo el ancho) */}
                                <div className="col-span-2 bg-indigo-900/20 p-3 rounded-xl border border-indigo-500/30 flex justify-between items-center">
                                    <div>
                                        <p className="text-xs text-indigo-300 mb-1">Fondo de Emergencia 🛡️</p>
                                        <p className="text-lg font-bold text-indigo-400">
                                            {perfilFinanciero.fondoEmergencia ? `$ ${parseFloat(perfilFinanciero.fondoEmergencia).toLocaleString('es-AR')}` : <span className="text-gray-500 text-sm">--</span>}
                                        </p>
                                    </div>
                                    {perfilFinanciero.fondoEmergencia > 0 && perfilFinanciero.gastosFijos > 0 && (
                                        <div className="text-right">
                                            <p className="text-xs text-gray-400">Cubres aprox.</p>
                                            <p className="text-sm font-bold text-white">
                                                {Math.floor(parseFloat(perfilFinanciero.fondoEmergencia) / (parseFloat(perfilFinanciero.gastosFijos) + resumenTotalGeneral))} Meses
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                        {/* SALDO (Solo en tarjeta específica) */}
                        {!esVistaGastosDiarios && !esVistaGeneral && !esVistaDeudas && tarjetaActiva && tarjetaActiva.mostrarSaldo !== false && (
                            <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full border-t-4 border-teal-500 relative">
                                <div className="flex justify-between items-start mb-2">
                                    <h2 className="text-xl font-semibold text-gray-300">Saldo de {tarjetaActiva.nombre}</h2>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={handleRecalcularSaldo}
                                            title="Recalcular saldo basado en cuotas pendientes"
                                            className="bg-orange-600 text-white px-3 py-1 text-xs font-bold rounded-lg hover:bg-orange-700 transition"
                                        >
                                            Recalcular
                                        </button>
                                    </div>
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
                        {/* ASESOR IA (MODO ARGENTINA) + PERFIL FINANCIERO */}
                        <div className="bg-gray-800 p-6 rounded-2xl shadow-xl w-full border-t-4 border-sky-400 relative">
                            {/* Cabecera con Botón de Configuración */}
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-xl font-semibold text-gray-300 flex items-center gap-2">
                                    🇦🇷 Asesor IA <span className="text-xs bg-sky-900 text-sky-200 px-2 py-1 rounded-full">SMART</span>
                                </h2>
                            </div>
                            {/*
                             <button
                                    onClick={() => setMostrarConfigPerfil(true)}
                                    className="text-gray-400 hover:text-white hover:bg-gray-700 p-2 rounded-full transition"
                                    title="Configurar mis ingresos y gastos"
                                >
                                    ⚙️ Mis Datos
                                </button>
                            */}

                            {/* Resumen rápido de capacidad (Solo si hay datos cargados) 
                            {perfilFinanciero.sueldo > 0 && (
                                <div className="mb-4 bg-gray-700/50 p-3 rounded-lg text-xs flex justify-between border border-gray-600">
                                    <span>Ingreso: <span className="text-green-400">${parseFloat(perfilFinanciero.sueldo).toLocaleString('es-AR')}</span></span>
                                    <span>Libre Aprox: <span className="text-sky-400">${(perfilFinanciero.sueldo - perfilFinanciero.gastosFijos - resumenTotalGeneral).toLocaleString('es-AR')}</span></span>
                                </div>
                            )}
                            */}
                            {/* Inputs de la Calculadora (Lo que ya tenías) */}
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
                                    <div className="mt-4 bg-gray-900/50 p-4 rounded-xl border border-gray-600">
                                        {/* Cabecera del Veredicto */}
                                        <div className="flex justify-between items-center mb-2">
                                            <h3 className={`text-lg font-black ${resultadoCalc.veredictoColor}`}>{resultadoCalc.veredicto}</h3>
                                            <span className="text-xs text-gray-400 font-mono">Score: {Math.round(resultadoCalc.score)}/100</span>
                                        </div>

                                        {/* Barra de Score */}
                                        <div className="w-full bg-gray-700 rounded-full h-2.5 mb-4">
                                            <div
                                                className={`h-2.5 rounded-full transition-all duration-1000 ease-out ${resultadoCalc.score > 60 ? 'bg-green-500' : resultadoCalc.score > 40 ? 'bg-yellow-500' : 'bg-red-600'}`}
                                                style={{ width: `${resultadoCalc.score}%` }}
                                            ></div>
                                        </div>

                                        {/* Datos Duros */}
                                        <div className="grid grid-cols-2 gap-2 text-xs mb-3 bg-gray-800 p-2 rounded-lg">
                                            <div className="flex flex-col">
                                                <span className="text-gray-400">Cuota Real:</span>
                                                <span className="font-bold text-white">$ {resultadoCalc.valorCuotaReal.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                                            </div>
                                            <div className="flex flex-col items-end">
                                                <span className="text-gray-400">Ahorro Real:</span>
                                                <span className={`${resultadoCalc.diferencia > 0 ? "text-green-400" : "text-red-400"} font-bold`}>
                                                    {resultadoCalc.diferencia > 0 ? 'Ganás ' : 'Perdés '}
                                                    $ {Math.abs(resultadoCalc.diferencia).toFixed(0)}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Consejos Inteligentes */}
                                        <div className="space-y-1">
                                            {resultadoCalc.consejos.map((c, i) => (
                                                <p key={i} className="text-xs text-gray-300 flex items-start gap-1">
                                                    <span>•</span> {c}
                                                </p>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* MODAL: CONFIGURACIÓN DE PERFIL */}
                        {mostrarConfigPerfil && (
                            <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
                                <div className="bg-gray-800 p-6 rounded-2xl w-full max-w-md border border-gray-600 shadow-2xl">
                                    <h3 className="text-2xl font-bold text-white mb-2">Mi Realidad Financiera 💰</h3>
                                    <p className="text-gray-400 text-sm mb-6">Estos datos son privados y se usan solo para calcular tu capacidad de endeudamiento real.</p>

                                    <form onSubmit={handleGuardarPerfil} className="flex flex-col gap-4">
                                        <div>
                                            <label className="text-sm font-semibold text-gray-300">Ingreso Mensual Neto (Sueldo)</label>
                                            <input
                                                type="number"
                                                placeholder="Ej: 800000"
                                                value={perfilFinanciero.sueldo}
                                                onChange={(e) => setPerfilFinanciero({ ...perfilFinanciero, sueldo: e.target.value })}
                                                className="w-full p-3 rounded-xl bg-gray-700 text-white border border-gray-600 focus:ring-sky-500 mt-1"
                                            />
                                        </div>

                                        <div>
                                            <label className="text-sm font-semibold text-gray-300">Gastos Fijos Mensuales</label>
                                            <p className="text-xs text-gray-500 mb-1">Alquiler, luz, gas, internet, comida base, etc.</p>
                                            <input
                                                type="number"
                                                placeholder="Ej: 350000"
                                                value={perfilFinanciero.gastosFijos}
                                                onChange={(e) => setPerfilFinanciero({ ...perfilFinanciero, gastosFijos: e.target.value })}
                                                className="w-full p-3 rounded-xl bg-gray-700 text-white border border-gray-600 focus:ring-sky-500"
                                            />
                                        </div>

                                        <div>
                                            <label className="text-sm font-semibold text-gray-300">Fondo de Emergencia (Ahorros)</label>
                                            <input
                                                type="number"
                                                placeholder="¿Cuánto dinero tenés disponible hoy?"
                                                value={perfilFinanciero.fondoEmergencia}
                                                onChange={(e) => setPerfilFinanciero({ ...perfilFinanciero, fondoEmergencia: e.target.value })}
                                                className="w-full p-3 rounded-xl bg-gray-700 text-white border border-gray-600 focus:ring-sky-500 mt-1"
                                            />
                                        </div>

                                        <div className="flex gap-3 mt-4">
                                            <button type="submit" className="flex-1 bg-sky-600 hover:bg-sky-700 text-white font-bold p-3 rounded-xl transition">Guardar Datos</button>
                                            <button type="button" onClick={() => setMostrarConfigPerfil(false)} className="flex-1 bg-gray-600 hover:bg-gray-700 text-white p-3 rounded-xl transition">Cancelar</button>
                                        </div>
                                    </form>
                                </div>
                            </div>
                        )}
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
                !esVistaGastosDiarios && (
                    <div className="w-full max-w-2xl bg-gray-800 p-8 rounded-2xl shadow-xl border-t-4 border-green-500 text-center my-8">
                        <h2 className="text-3xl font-bold mb-4 text-white">¡Bienvenido! 👋</h2>
                        <p className="text-gray-300 mb-6 text-lg">Para comenzar a ordenar tus finanzas, necesitas agregar tu primera tarjeta o cuenta.</p>
                        <button onClick={() => setMostrarFormularioTarjeta(true)} className="bg-green-600 text-white font-bold py-3 px-8 rounded-full hover:bg-green-700 transition transform hover:scale-105 shadow-lg">
                            + Agregar mi primera tarjeta
                        </button>
                    </div>
                )

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
                {!esVistaGastosDiarios && (
                    <div className="flex bg-gray-700 p-1 rounded-xl mb-6">
                        <button onClick={() => setVerHistorial(false)} className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${!verHistorial ? 'bg-teal-600 text-white shadow-md' : 'text-gray-400 hover:text-white'}`}>Pendientes</button>
                        <button onClick={() => setVerHistorial(true)} className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${verHistorial ? 'bg-teal-600 text-white shadow-md' : 'text-gray-400 hover:text-white'}`}>Historial Pagado</button>
                    </div>
                )}


                {(itemsVisualizados || []).length > 0 ? (
                    <ul className="space-y-4">
                        {(itemsVisualizados || []).map((item, index) => {
                            const realIndex = (itemsActivos || []).indexOf(item);

                            // Formateo de Fecha
                            const fechaObj = item.fecha ? new Date(item.fecha + 'T12:00:00') : new Date();
                            const dia = fechaObj.getDate();
                            const mes = fechaObj.toLocaleString('es-AR', { month: 'short' }).toUpperCase().replace('.', '');

                            return (
                                <li key={index} className={`flex flex-col sm:flex-row justify-between items-start sm:items-center bg-gray-700 p-3 sm:p-4 rounded-xl border border-gray-600 gap-3 transition hover:bg-gray-600/50 ${verHistorial ? 'opacity-75' : ''}`}>

                                    {/* IZQUIERDA: Fecha + Info */}
                                    <div className="flex items-center gap-4 w-full sm:w-auto">

                                        {/* Badge de FECHA (Estilo Calendario) */}
                                        <div className={`flex flex-col items-center justify-center p-2 rounded-xl min-w-[60px] text-center border shadow-inner ${esVistaGastosDiarios ? 'bg-emerald-900/40 border-emerald-500/30' : 'bg-gray-800 border-gray-500/30'}`}>
                                            <span className={`text-[10px] font-bold tracking-wider ${esVistaGastosDiarios ? 'text-emerald-400' : 'text-gray-400'}`}>{mes}</span>
                                            <span className="text-2xl font-black text-white leading-none">{dia}</span>
                                        </div>

                                        {/* Detalles del Item */}
                                        <div>
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <p className="font-bold text-lg text-white">{item.descripcion}</p>
                                                {/* Etiquetas solo si NO son gastos diarios (ya que esos siempre son pagados) */}
                                                {!esVistaGastosDiarios && item.pagada && <span className="text-[10px] font-bold text-white bg-green-600 px-2 py-0.5 rounded-full">PAGADA</span>}
                                                {!esVistaGastosDiarios && item.postergada && <span className="text-[10px] font-bold text-black bg-yellow-400 px-2 py-0.5 rounded-full">POSTERGADA</span>}
                                            </div>

                                            <p className="text-xs text-gray-400 mb-1">{item.categoria}</p>

                                            {/* Precios Diferenciados */}
                                            {esVistaGastosDiarios ? (
                                                <p className="text-xl font-bold text-emerald-400">$ {item.montoTotal.toLocaleString('es-AR')}</p>
                                            ) : (
                                                <>
                                                    <p className="text-sm text-gray-300">Total: <span className="font-semibold">$ {item.montoTotal.toLocaleString('es-AR')}</span> ({item.cuotas} cuotas)</p>
                                                    <p className="text-base text-cyan-300 font-mono mt-1">Cuota: $ {item.montoCuota.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
                                                    <p className="text-xs text-gray-500 italic">Restantes: {item.cuotasRestantes}</p>
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    {/* DERECHA: Botones de Acción */}
                                    <div className="flex flex-row sm:flex-col gap-2 w-full sm:w-auto justify-end mt-2 sm:mt-0 border-t sm:border-t-0 border-gray-600 pt-2 sm:pt-0">
                                        {!esVistaGeneral && !esVistaGastosDiarios && (
                                            <>
                                                {!verHistorial && item.cuotasRestantes > 0 && (
                                                    <button onClick={() => handlePagarCuota(realIndex)} className="bg-green-600/20 hover:bg-green-600 text-green-400 hover:text-white border border-green-600 p-2 rounded-lg text-xs font-bold transition">
                                                        Pagar
                                                    </button>
                                                )}
                                                <button onClick={() => iniciarEdicion(realIndex)} className="bg-yellow-500/20 hover:bg-yellow-600 text-yellow-400 hover:text-white border border-yellow-600 p-2 rounded-lg text-xs font-bold transition disabled:opacity-50" disabled={item.pagada && !verHistorial}>
                                                    {verHistorial ? 'Ver' : 'Edit'}
                                                </button>
                                            </>
                                        )}

                                        {/* Eliminar (Disponible en todo menos General) */}
                                        {!esVistaGeneral && (
                                            <button onClick={() => eliminarItem(realIndex)} className="bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white border border-red-600 p-2 rounded-lg text-xs font-bold transition">
                                                ✕
                                            </button>
                                        )}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                ) : (
                    <div className="text-center py-12 opacity-50">
                        <p className="text-4xl mb-2">🍃</p>
                        <p className="text-gray-400 text-lg">Nada por aquí aún.</p>
                    </div>
                )}
            </div>
        </main>
    );
}

export default function HomePage() { return <AuthWrapper />; }