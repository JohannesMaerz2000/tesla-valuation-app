import React, { useState, useEffect, useMemo } from "react";
import { POWERTRAIN_OPTIONS, predictPrice } from "./utils/valuation";
import teslaData from "./data/tesla_data.json";
import {
    Car,
    Calendar,
    Gauge,
    Info,
    CheckCircle,
    AlertTriangle,
    Settings,
    DollarSign,
    Briefcase,
    User,
} from "lucide-react";

function App() {
    // State
    const [model, setModel] = useState("Model 3");
    const [powertrainId, setPowertrainId] = useState("m3_lr");
    const [registrationDate, setRegistrationDate] = useState("2023-01-01");
    const [mileage, setMileage] = useState(30000);
    const [isNetPrice, setIsNetPrice] = useState(false); // Default Private/Margin
    const [hasAhk, setHasAhk] = useState(false);
    const [isAccidentFree, setIsAccidentFree] = useState(true);
    const [tireOption, setTireOption] = useState("4_summer"); // Options: "8_tires", "4_summer", "4_winter", "4_all_season"

    // Derived State: Available Powertrains
    const availablePowertrains = POWERTRAIN_OPTIONS[model] || [];

    // Effect: Reset powertrain choice when model changes
    useEffect(() => {
        const options = POWERTRAIN_OPTIONS[model];
        if (options && options.length > 0) {
            // Default to Long Range if available, else first
            const lr = options.find((o) => o.label.includes("Long Range"));
            setPowertrainId(lr ? lr.id : options[0].id);
        }
    }, [model]);

    // Calculation
    const prediction = useMemo(() => {
        return predictPrice(
            {
                model,
                powertrainId,
                registrationDate,
                mileage: Number(mileage),
                isNetPrice,
                hasAhk,
                isAccidentFree,
                hasAhk,
                isAccidentFree,
                tireOption,
            },
            teslaData
        );
    }, [
        model,
        powertrainId,
        registrationDate,
        mileage,
        isNetPrice,
        hasAhk,
        isAccidentFree,
        tireOption,
    ]);

    const { price, neighbors } = prediction;

    // Formatting
    const formatMoney = (amount) => {
        return new Intl.NumberFormat("de-DE", {
            style: "currency",
            currency: "EUR",
            maximumFractionDigits: 0,
        }).format(amount);
    };

    return (
        <div className="min-h-screen bg-[#050505] text-white p-4 md:p-8 font-sans">
            <div className="max-w-6xl mx-auto">
                <header className="mb-8 border-b border-gray-800 pb-4 flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-red-500 to-red-600">
                            Tesla Valuation
                        </h1>
                        <p className="text-gray-400 text-sm mt-1">
                            Data-driven pricing based on real auction results
                        </p>
                    </div>
                    <div className="text-xs text-gray-500 text-right">
                        Database: {teslaData.length} vehicles<br />
                        Status: Live
                    </div>
                </header>

                <main className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                    {/* Controls Column */}
                    <section className="lg:col-span-5 space-y-6">
                        <div className="bg-[#111] border border-gray-800 rounded-xl p-6 shadow-xl">
                            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                                <Settings className="w-5 h-5 text-red-500" />
                                Configuration
                            </h2>

                            <div className="space-y-4">
                                {/* Model */}
                                <div>
                                    <label className="block text-sm text-gray-400 mb-1">Model</label>
                                    <div className="grid grid-cols-2 gap-2">
                                        {["Model 3", "Model Y"].map((m) => (
                                            <button
                                                key={m}
                                                onClick={() => setModel(m)}
                                                className={`py-2 px-4 rounded-lg border transition-all ${model === m
                                                    ? "bg-red-500/10 border-red-500 text-red-500 font-medium"
                                                    : "bg-[#1a1a1a] border-gray-700 text-gray-300 hover:border-gray-500"
                                                    }`}
                                            >
                                                {m}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Powertrain */}
                                <div>
                                    <label className="block text-sm text-gray-400 mb-1">Variant</label>
                                    <select
                                        value={powertrainId}
                                        onChange={(e) => setPowertrainId(e.target.value)}
                                        className="w-full bg-[#1a1a1a] border border-gray-700 rounded-lg p-2.5 text-white focus:border-red-500 focus:outline-none transition-colors appearance-none"
                                    >
                                        {availablePowertrains.map((opt) => (
                                            <option key={opt.id} value={opt.id}>
                                                {opt.label} ({opt.kwDisplay} kW / {opt.battery} kWh)
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                {/* Date & Mileage */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm text-gray-400 mb-1 flex items-center gap-1">
                                            <Calendar className="w-3 h-3" /> Registration
                                        </label>
                                        <input
                                            type="date"
                                            value={registrationDate}
                                            onChange={(e) => setRegistrationDate(e.target.value)}
                                            className="w-full bg-[#1a1a1a] border border-gray-700 rounded-lg p-2.5 text-white focus:border-red-500 focus:outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm text-gray-400 mb-1 flex items-center gap-1">
                                            <Gauge className="w-3 h-3" /> Mileage (km)
                                        </label>
                                        <input
                                            type="number"
                                            value={mileage}
                                            onChange={(e) => setMileage(e.target.value)}
                                            className="w-full bg-[#1a1a1a] border border-gray-700 rounded-lg p-2.5 text-white focus:border-red-500 focus:outline-none"
                                        />
                                    </div>
                                </div>

                                {/* Seller Type (Taxation) */}
                                <div>
                                    <label className="block text-sm text-gray-400 mb-1 flex items-center gap-1">
                                        Taxation / Document Type
                                    </label>
                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            onClick={() => setIsNetPrice(false)}
                                            className={`py-2 px-3 rounded-lg border text-sm transition-all flex items-center justify-center gap-2 ${!isNetPrice
                                                ? "bg-blue-500/10 border-blue-500 text-blue-400"
                                                : "bg-[#1a1a1a] border-gray-700 text-gray-400"
                                                }`}
                                        >
                                            <User className="w-4 h-4" /> Private (Margin)
                                        </button>
                                        <button
                                            onClick={() => setIsNetPrice(true)}
                                            className={`py-2 px-3 rounded-lg border text-sm transition-all flex items-center justify-center gap-2 ${isNetPrice
                                                ? "bg-blue-500/10 border-blue-500 text-blue-400"
                                                : "bg-[#1a1a1a] border-gray-700 text-gray-400"
                                                }`}
                                        >
                                            <Briefcase className="w-4 h-4" /> Company (VAT)
                                        </button>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1">
                                        {isNetPrice ? "Using Net Price for comparison." : "Using Gross Price for comparison."}
                                    </p>
                                </div>

                                {/* Additional Options */}
                                <div className="pt-4 border-t border-gray-800 space-y-3">
                                    <h3 className="text-sm font-medium text-gray-300">Attributes</h3>

                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-gray-400">Accident Free</span>
                                        <button
                                            onClick={() => setIsAccidentFree(!isAccidentFree)}
                                            className={`w-12 h-6 rounded-full p-1 transition-colors ${isAccidentFree ? 'bg-green-500' : 'bg-gray-700'}`}
                                        >
                                            <div className={`w-4 h-4 rounded-full bg-white transition-transform ${isAccidentFree ? 'translate-x-6' : ''}`} />
                                        </button>
                                    </div>

                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-gray-400">Trailer Hitch</span>
                                        <button
                                            onClick={() => setHasAhk(!hasAhk)}
                                            className={`w-12 h-6 rounded-full p-1 transition-colors ${hasAhk ? 'bg-red-500' : 'bg-gray-700'}`}
                                        >
                                            <div className={`w-4 h-4 rounded-full bg-white transition-transform ${hasAhk ? 'translate-x-6' : ''}`} />
                                        </button>
                                    </div>

                                    <div className="pt-2">
                                        <label className="text-xs text-gray-500 block mb-1">Tires</label>
                                        <select
                                            value={tireOption}
                                            onChange={e => setTireOption(e.target.value)}
                                            className="w-full bg-[#1a1a1a] border border-gray-700 rounded p-1.5 text-sm"
                                        >
                                            <option value="8_tires">8 Tires (Summer + Winter)</option>
                                            <option value="4_summer">4 Tires (Summer Only)</option>
                                            <option value="4_winter">4 Tires (Winter Only)</option>
                                            <option value="4_all_season">4 Tires (All-Season)</option>
                                        </select>
                                    </div>
                                </div>

                            </div>
                        </div>
                    </section>

                    {/* Results Column */}
                    <section className="lg:col-span-7 space-y-6">
                        {/* Main Valuation Card */}
                        <div className="bg-gradient-to-br from-[#151515] to-[#0a0a0a] border border-gray-800 rounded-2xl p-8 relative overflow-hidden shadow-2xl">
                            <div className="absolute top-0 right-0 p-32 bg-red-500/5 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none"></div>

                            <div className="relative z-10 text-center">
                                <h2 className="text-gray-400 text-sm uppercase tracking-wider mb-2">Estimated Value</h2>
                                <div className="text-6xl font-black text-white mb-2 tracking-tight">
                                    {formatMoney(price)}
                                </div>
                                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-gray-400">
                                    <Info className="w-3 h-3" />
                                    <span>Based on {neighbors.length} comparable vehicles</span>
                                </div>
                            </div>
                        </div>

                        {/* Comparables List */}
                        <div className="space-y-4">
                            <h3 className="text-lg font-semibold text-gray-300 px-1">Comparable Vehicles (Top 4)</h3>

                            {neighbors.length === 0 ? (
                                <div className="p-8 text-center text-gray-500 bg-[#111] rounded-xl border border-gray-800">
                                    No matches found. Try adjusting your filters (e.g. check VAT settings).
                                </div>
                            ) : (
                                neighbors.map((car, idx) => (
                                    <div key={idx} className="bg-[#111] border border-gray-700/50 rounded-xl p-5 hover:border-gray-600 transition-colors">

                                        {/* Header Row: Basic Info & Price */}
                                        <div className="flex justify-between items-start mb-4">
                                            <div>
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="font-semibold text-white">{car.model}</span>
                                                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">{car.powe_kw} kW</span>
                                                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">{Math.round(car.battery_netto)} kWh</span>
                                                </div>
                                                <div className="text-sm text-gray-400 flex flex-wrap gap-x-4 gap-y-1">
                                                    <span>{car.first_registration}</span>
                                                    <span>{car.mileage.toLocaleString()} km</span>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-xl font-bold text-white tracking-tight">{formatMoney(car.price)}</div>
                                                <div className="text-xs text-gray-500">
                                                    Score: {car.score.toFixed(2)}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Attributes Breakdown */}
                                        <div className="bg-white/5 rounded-lg p-4 text-sm flex flex-col gap-2">
                                            {/* Mileage */}
                                            <div className="flex justify-between items-center border-b border-gray-700/50 pb-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-gray-400">Mileage</span>
                                                    <span className="text-gray-300 text-xs hidden sm:inline">
                                                        {car.mileage.toLocaleString()} km
                                                        <span className="text-gray-500 ml-1">
                                                            ({car.matchDetails.diffMileage > 0 ? '+' : ''}{car.matchDetails.diffMileage.toLocaleString()})
                                                        </span>
                                                    </span>
                                                </div>
                                                {car.matchDetails.mileagePenalty < 0.1 ? (
                                                    <CheckCircle className="w-4 h-4 text-green-500" />
                                                ) : (
                                                    <span className="text-red-400 font-mono text-xs">+{car.matchDetails.mileagePenalty.toFixed(1)} pts</span>
                                                )}
                                            </div>

                                            {/* Age / Registration */}
                                            <div className="flex justify-between items-center border-b border-gray-700/50 pb-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-gray-400">Age</span>
                                                    <span className="text-gray-300 text-xs hidden sm:inline">
                                                        {car.first_registration}
                                                        <span className="text-gray-500 ml-1">
                                                            ({car.matchDetails.diffMonths > 0 ? '+' : ''}{car.matchDetails.diffMonths} mo)
                                                        </span>
                                                    </span>
                                                </div>
                                                {car.matchDetails.agePenalty < 0.1 ? (
                                                    <CheckCircle className="w-4 h-4 text-green-500" />
                                                ) : (
                                                    <span className="text-red-400 font-mono text-xs">+{car.matchDetails.agePenalty.toFixed(1)} pts</span>
                                                )}
                                            </div>

                                            {/* Accident Free */}
                                            <div className="flex justify-between items-center border-b border-gray-700/50 pb-1">
                                                <span className="text-gray-400">Accident Free</span>
                                                {!car.penalties.accident ? (
                                                    <CheckCircle className="w-4 h-4 text-green-500" />
                                                ) : (
                                                    <span className="text-red-400 font-mono text-xs">+{car.penalties.accident} pts</span>
                                                )}
                                            </div>

                                            {/* Trailer Hitch */}
                                            <div className="flex justify-between items-center border-b border-gray-700/50 pb-1">
                                                <span className="text-gray-400">Trailer Hitch</span>
                                                {!car.penalties.ahk ? (
                                                    <CheckCircle className="w-4 h-4 text-green-500" />
                                                ) : (
                                                    <span className="text-red-400 font-mono text-xs">+{car.penalties.ahk} pts</span>
                                                )}
                                            </div>

                                            {/* Tires */}
                                            <div className="flex justify-between items-center border-b border-gray-700/50 pb-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-gray-400">Tires</span>
                                                    <span className="text-gray-500 text-xs">
                                                        ({car.matchDetails.tireMatchLabel})
                                                    </span>
                                                </div>
                                                {(!car.penalties.tire) ? (
                                                    <CheckCircle className="w-4 h-4 text-green-500" />
                                                ) : (
                                                    <span className="text-red-400 font-mono text-xs">+{car.penalties.tire} pts</span>
                                                )}
                                            </div>

                                            {/* Recency */}
                                            <div className="flex justify-between items-center">
                                                <span className="text-gray-400">Recency</span>
                                                <span className="text-red-400 font-mono text-xs">+{car.matchDetails.recencyPenalty.toFixed(1)} pts</span>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </section>
                </main>
            </div>
        </div >
    );
}

export default App;
