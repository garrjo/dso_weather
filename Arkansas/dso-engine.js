/**
 * DSO Weather Prediction Engine
 * Drag-Scale-Object E-Field Severe Weather Model
 * 
 * Core equations:
 *   Probability: P = E_fuel × |dθ/dt| × sin(α)
 *   Volatility:  V = (∂E/∂φ) × |dθ/dt| × sin(α)
 *   Danger:      D = E_fuel × (∂E/∂φ) × (dθ/dt)² × sin²(α)
 * 
 * Author: Joe Garrett / VaultSync Solutions Inc.
 * © 2026
 */

class DSOWeatherEngine {
    constructor() {
        // Regional configurations
        this.regions = {
            'benton_ar': {
                name: 'Benton, AR',
                lat: 34.5645,
                lon: -92.5868,
                gulfDistance: 650,  // km to Gulf coast
                elevation: 127,     // meters
                gradientZone: 0.85  // How much of the gradient "wall" hits this area
            },
            'little_rock': {
                name: 'Little Rock, AR',
                lat: 34.7465,
                lon: -92.2896,
                gulfDistance: 680,
                elevation: 102,
                gradientZone: 0.82
            },
            'haskell_ar': {
                name: 'Haskell, AR',
                lat: 34.5012,
                lon: -92.6368,
                gulfDistance: 645,
                elevation: 91,
                gradientZone: 0.86
            },
            'tornado_alley': {
                name: 'Tornado Alley (OK/KS)',
                lat: 35.5,
                lon: -98.0,
                gulfDistance: 800,
                elevation: 400,
                gradientZone: 1.00
            },
            'dixie_alley': {
                name: 'Dixie Alley (MS/AL)',
                lat: 33.0,
                lon: -88.0,
                gulfDistance: 350,
                elevation: 150,
                gradientZone: 0.75
            }
        };

        // Gulf SST baseline (can be adjusted for climate scenarios)
        this.gulfSSTBaseline = 26.5;  // °C average
        this.climateOffset = 0;        // Additional warming
    }

    // ═══════════════════════════════════════════════════════════════
    //                    ASTRONOMICAL CALCULATIONS
    // ═══════════════════════════════════════════════════════════════

    /**
     * Get day of year from Date object
     */
    getDayOfYear(date) {
        const start = new Date(date.getFullYear(), 0, 0);
        const diff = date - start;
        const oneDay = 1000 * 60 * 60 * 24;
        return Math.floor(diff / oneDay);
    }

    /**
     * Calculate Earth's axial tilt angle for a given day
     * θ(t) = 23.5° × sin(2πt/365)
     */
    getTiltAngle(dayOfYear) {
        return 23.5 * Math.sin((2 * Math.PI * dayOfYear) / 365.25);
    }

    /**
     * THE CATALYST: Rate of tilt change (dθ/dt)
     * 
     * The tilt angle follows: θ(t) = 23.5° × sin(2π(t - 80)/365)
     * where t=80 is vernal equinox (March 20)
     * 
     * Rate of change: dθ/dt = 23.5° × (2π/365) × cos(2π(t - 80)/365)
     * 
     * This PEAKS at equinoxes (t=80, t=266) when cos()=1
     * This is ZERO at solstices (t=172, t=355) when cos()=0
     * 
     * This is the rotation driver - peaks at equinoxes, zero at solstices
     */
    getCatalyst(dayOfYear) {
        // Shift so that day 80 (March 20 equinox) gives cos(0) = 1 (maximum)
        const phase = (2 * Math.PI * (dayOfYear - 80)) / 365.25;
        const rawValue = 23.5 * (2 * Math.PI / 365.25) * Math.cos(phase);
        // Normalize to 0-1 range (max raw value ≈ 0.405)
        return Math.abs(rawValue) / 0.405;
    }

    /**
     * Solar declination angle
     */
    getSolarDeclination(dayOfYear) {
        return 23.45 * Math.sin((2 * Math.PI / 365.25) * (dayOfYear - 81));
    }

    /**
     * Solar angle factor: sin(α) at solar noon for given latitude
     */
    getSolarAngle(dayOfYear, latitude) {
        const declination = this.getSolarDeclination(dayOfYear);
        const declinationRad = declination * Math.PI / 180;
        const latRad = latitude * Math.PI / 180;
        
        // Solar elevation at noon
        const sinAlpha = Math.sin(latRad) * Math.sin(declinationRad) + 
                         Math.cos(latRad) * Math.cos(declinationRad);
        
        return Math.max(0, Math.min(1, sinAlpha));
    }

    // ═══════════════════════════════════════════════════════════════
    //                    ENERGY/FUEL CALCULATIONS
    // ═══════════════════════════════════════════════════════════════

    /**
     * Gulf SST seasonal variation
     * Peaks in August/September, minimum in February/March
     */
    getGulfSST(dayOfYear) {
        // Seasonal variation: ~24°C in Feb to ~30°C in Aug
        const seasonalOffset = 3 * Math.sin((2 * Math.PI * (dayOfYear - 45)) / 365.25);
        return this.gulfSSTBaseline + seasonalOffset + this.climateOffset;
    }

    /**
     * E-Fuel: Available energy based on Gulf SST and distance
     * Decays with distance from Gulf
     */
    getFuel(dayOfYear, gulfDistance) {
        const sst = this.getGulfSST(dayOfYear);
        // Normalize SST to 0-1 (20°C = 0, 32°C = 1)
        const sstNorm = (sst - 20) / 12;
        // Distance decay (exponential with ~1500km scale)
        const distanceDecay = Math.exp(-gulfDistance / 1500);
        return Math.max(0, Math.min(1, sstNorm * distanceDecay * 1.5));
    }

    /**
     * E-Gradient: Thermal gradient (∂E/∂φ)
     * The "wall" effect - peaks when warm Gulf air collides with cold Arctic air
     * Strongest in spring when temperature contrasts are maximum
     */
    getGradient(dayOfYear, gradientZone) {
        // Gradient peaks in early spring (day ~80) and has secondary peak in fall
        const springPeak = Math.exp(-Math.pow((dayOfYear - 100) / 45, 2));
        const fallPeak = Math.exp(-Math.pow((dayOfYear - 290) / 50, 2)) * 0.7;
        const gradient = Math.max(springPeak, fallPeak);
        return gradient * gradientZone;
    }

    // ═══════════════════════════════════════════════════════════════
    //                    INVERSION CALCULATIONS
    // ═══════════════════════════════════════════════════════════════

    /**
     * Inversion Ratio: catalyst / solar angle
     * When > 1.2, energy discharges horizontally (bomb cyclone)
     * When < 1.0, energy discharges vertically (convective storms)
     */
    getInversionRatio(catalyst, solarAngle) {
        return catalyst / (solarAngle + 0.1);
    }

    /**
     * Determine discharge mode based on inversion ratio
     */
    getDischargeMode(inversionRatio) {
        if (inversionRatio > 1.2) return 'HORIZONTAL';  // Bomb cyclone territory
        if (inversionRatio > 1.0) return 'TRANSITIONAL';
        return 'VERTICAL';  // Standard convective
    }

    // ═══════════════════════════════════════════════════════════════
    //                    CORE PREDICTION EQUATIONS
    // ═══════════════════════════════════════════════════════════════

    /**
     * Probability: Will a storm occur?
     * P = E_fuel × |dθ/dt| × sin(α)
     */
    getProbability(fuel, catalyst, solarAngle) {
        return fuel * catalyst * solarAngle;
    }

    /**
     * Volatility: How violent if it occurs?
     * V = (∂E/∂φ) × |dθ/dt| × sin(α)
     */
    getVolatility(gradient, catalyst, solarAngle) {
        return gradient * catalyst * solarAngle;
    }

    /**
     * Danger Index: Combined risk metric
     * D = E_fuel × (∂E/∂φ) × (dθ/dt)² × sin²(α)
     */
    getDangerIndex(fuel, gradient, catalyst, solarAngle) {
        return fuel * gradient * Math.pow(catalyst, 2) * Math.pow(solarAngle, 2);
    }

    // ═══════════════════════════════════════════════════════════════
    //                    STORM CLASSIFICATION
    // ═══════════════════════════════════════════════════════════════

    /**
     * Classify storm type based on factor combinations
     */
    classifyStorm(fuel, gradient, catalyst, solarAngle, inversionRatio) {
        const volatility = this.getVolatility(gradient, catalyst, solarAngle);
        const danger = this.getDangerIndex(fuel, gradient, catalyst, solarAngle);
        
        // Inversion mode -> horizontal discharge
        if (inversionRatio > 1.2) {
            if (fuel > 0.5) {
                return { type: 'BOMB_CYCLONE', severity: 'HIGH', color: '#9333ea' };
            }
            return { type: 'WINTER_STORM', severity: 'MODERATE', color: '#3b82f6' };
        }

        // High gradient + high catalyst = TORNADO
        if (gradient > 0.6 && catalyst > 0.5 && volatility > 0.35) {
            if (danger > 0.15) return { type: 'TORNADO', severity: 'EXTREME', color: '#dc2626' };
            if (danger > 0.08) return { type: 'TORNADO', severity: 'HIGH', color: '#ea580c' };
            return { type: 'SUPERCELL', severity: 'MODERATE', color: '#f59e0b' };
        }

        // High fuel + low catalyst = linear discharge
        if (fuel > 0.7 && catalyst < 0.3) {
            return { type: 'DERECHO', severity: 'MODERATE', color: '#0891b2' };
        }

        // Moderate factors = standard storms
        if (fuel > 0.4 && solarAngle > 0.5) {
            if (volatility > 0.2) return { type: 'SEVERE_TSTORM', severity: 'MODERATE', color: '#eab308' };
            return { type: 'THUNDERSTORM', severity: 'LOW', color: '#22c55e' };
        }

        // Low activity
        if (fuel < 0.3 || catalyst < 0.2) {
            return { type: 'FAIR', severity: 'MINIMAL', color: '#6b7280' };
        }

        return { type: 'UNSETTLED', severity: 'LOW', color: '#a3a3a3' };
    }

    // ═══════════════════════════════════════════════════════════════
    //                    MAIN PREDICTION INTERFACE
    // ═══════════════════════════════════════════════════════════════

    /**
     * Generate full prediction for a region and date
     */
    predict(regionId, date) {
        const region = this.regions[regionId];
        if (!region) throw new Error(`Unknown region: ${regionId}`);

        const dayOfYear = this.getDayOfYear(date);
        
        // Calculate all factors
        const catalyst = this.getCatalyst(dayOfYear);
        const solarAngle = this.getSolarAngle(dayOfYear, region.lat);
        const fuel = this.getFuel(dayOfYear, region.gulfDistance);
        const gradient = this.getGradient(dayOfYear, region.gradientZone);
        const inversionRatio = this.getInversionRatio(catalyst, solarAngle);
        const dischargeMode = this.getDischargeMode(inversionRatio);

        // Calculate indices
        const probability = this.getProbability(fuel, catalyst, solarAngle);
        const volatility = this.getVolatility(gradient, catalyst, solarAngle);
        const danger = this.getDangerIndex(fuel, gradient, catalyst, solarAngle);

        // Classify storm type
        const classification = this.classifyStorm(fuel, gradient, catalyst, solarAngle, inversionRatio);

        return {
            region: region.name,
            date: date.toISOString().split('T')[0],
            dayOfYear,
            
            factors: {
                catalyst: catalyst,
                solarAngle: solarAngle,
                fuel: fuel,
                gradient: gradient,
                inversionRatio: inversionRatio,
                dischargeMode: dischargeMode,
                gulfSST: this.getGulfSST(dayOfYear)
            },
            
            indices: {
                probability: probability,
                volatility: volatility,
                danger: danger
            },
            
            prediction: classification,
            
            // Human-readable risk level
            riskLevel: this.getRiskLevel(danger),
            
            // Mechanism explanation
            mechanism: this.getMechanismExplanation(classification.type, fuel, gradient, catalyst)
        };
    }

    /**
     * Generate multi-day forecast
     */
    forecast(regionId, startDate, days = 7) {
        const forecasts = [];
        const date = new Date(startDate);
        
        for (let i = 0; i < days; i++) {
            forecasts.push(this.predict(regionId, new Date(date)));
            date.setDate(date.getDate() + 1);
        }
        
        return forecasts;
    }

    /**
     * Convert danger index to human-readable risk level
     */
    getRiskLevel(danger) {
        if (danger > 0.15) return { level: 5, label: 'EXTREME', color: '#dc2626' };
        if (danger > 0.08) return { level: 4, label: 'HIGH', color: '#ea580c' };
        if (danger > 0.04) return { level: 3, label: 'MODERATE', color: '#f59e0b' };
        if (danger > 0.02) return { level: 2, label: 'LOW', color: '#22c55e' };
        return { level: 1, label: 'MINIMAL', color: '#6b7280' };
    }

    /**
     * Generate mechanism explanation for the prediction
     */
    getMechanismExplanation(type, fuel, gradient, catalyst) {
        const explanations = {
            'TORNADO': `High gradient (${(gradient*100).toFixed(0)}%) + high catalyst (${(catalyst*100).toFixed(0)}%) → maximum rotational potential`,
            'SUPERCELL': `Organized rotation likely with sustained updraft`,
            'SEVERE_TSTORM': `Sufficient fuel and instability for severe development`,
            'THUNDERSTORM': `Standard convective activity expected`,
            'DERECHO': `High fuel (${(fuel*100).toFixed(0)}%) + low catalyst → linear wind damage pattern`,
            'BOMB_CYCLONE': `Inversion mode: catalyst dominates solar → horizontal discharge`,
            'WINTER_STORM': `Low solar input + high catalyst → organized winter system`,
            'FAIR': `Insufficient energy/trigger combination`,
            'UNSETTLED': `Mixed signals - monitor for changes`
        };
        return explanations[type] || 'Standard atmospheric conditions';
    }

    /**
     * Set climate warming offset for projections
     */
    setClimateOffset(degreesCelsius) {
        this.climateOffset = degreesCelsius;
    }

    /**
     * Add custom region
     */
    addRegion(id, config) {
        this.regions[id] = config;
    }
}

// Export for Node.js or browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DSOWeatherEngine };
}
