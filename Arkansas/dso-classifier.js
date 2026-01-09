/**
 * DSO Weather Classifier - Complete Weather Prediction
 * 
 * Predicts ALL weather conditions based on four geometric factors:
 *   - Catalyst (dθ/dt): Rotation driver / jet stream dynamics
 *   - Gradient (∂E/∂φ): Thermal collision intensity
 *   - Fuel (E): Available energy from Gulf moisture
 *   - Solar Angle: Energy input intensity
 * 
 * Weather Types (ordered by severity):
 *   FAIR, PARTLY_CLOUDY, CLOUDY, FOG, DRIZZLE, RAIN, SHOWERS,
 *   THUNDERSTORM, SEVERE_TSTORM, SUPERCELL, TORNADO,
 *   DERECHO, HIGH_WIND, WINTER_MIX, FREEZING_RAIN, ICE_STORM,
 *   SNOW, WINTER_STORM, BLIZZARD, BOMB_CYCLONE
 * 
 * Empirically calibrated against NOAA Storm Events Database (1950-2025)
 * 
 * Author: Joe Garrett / VaultSync Solutions Inc.
 * © 2026
 */

class DSOWeatherClassifier {
    constructor() {
        // Empirically derived thresholds from historical validation
        this.thresholds = {
            // Severe convective
            TORNADO: {
                catalyst: { min: 0.50, typical: 0.80 },
                gradient: { min: 0.45, typical: 0.72 },
                fuel: { min: 0.40, typical: 0.49 },
                danger: { min: 0.05, typical: 0.15 },
                inversionMax: 1.0  // Must be in vertical discharge mode
            },
            SUPERCELL: {
                catalyst: { min: 0.40, typical: 0.65 },
                gradient: { min: 0.35, typical: 0.55 },
                fuel: { min: 0.35, typical: 0.45 },
                danger: { min: 0.03, typical: 0.08 }
            },
            SEVERE_TSTORM: {
                catalyst: { min: 0.25, typical: 0.50 },
                gradient: { min: 0.10, typical: 0.30 },
                fuel: { min: 0.30, typical: 0.45 },
                danger: { min: 0.005, typical: 0.03 }
            },
            DERECHO: {
                catalyst: { max: 0.35 },  // Low catalyst = linear (not rotating)
                fuel: { min: 0.65 },       // High fuel
                gradient: { min: 0.20, max: 0.50 },
                solarAngle: { min: 0.70 }  // Summer
            },
            
            // Standard convective
            THUNDERSTORM: {
                fuel: { min: 0.35 },
                solarAngle: { min: 0.50 },
                catalyst: { min: 0.15 }
            },
            SHOWERS: {
                fuel: { min: 0.25 },
                solarAngle: { min: 0.40 }
            },
            RAIN: {
                fuel: { min: 0.20 },
                gradient: { min: 0.05 }
            },
            DRIZZLE: {
                fuel: { min: 0.15, max: 0.35 },
                gradient: { max: 0.15 }
            },
            
            // Winter weather
            BLIZZARD: {
                catalyst: { min: 0.60 },
                fuel: { max: 0.30 },
                solarAngle: { max: 0.55 },
                gradient: { min: 0.25 },
                inversionMin: 1.0
            },
            WINTER_STORM: {
                catalyst: { min: 0.40 },
                fuel: { max: 0.40 },
                solarAngle: { max: 0.60 },
                gradient: { min: 0.10 }
            },
            ICE_STORM: {
                catalyst: { min: 0.30 },
                fuel: { min: 0.25, max: 0.50 },
                solarAngle: { min: 0.45, max: 0.65 },
                gradient: { min: 0.15 }
            },
            FREEZING_RAIN: {
                fuel: { min: 0.20, max: 0.45 },
                solarAngle: { min: 0.40, max: 0.60 }
            },
            SNOW: {
                fuel: { max: 0.35 },
                solarAngle: { max: 0.55 }
            },
            WINTER_MIX: {
                fuel: { min: 0.20, max: 0.45 },
                solarAngle: { min: 0.45, max: 0.65 }
            },
            
            // Synoptic scale
            BOMB_CYCLONE: {
                catalyst: { min: 0.55 },
                inversionMin: 1.2,  // Horizontal discharge mode
                fuel: { min: 0.40 }
            },
            HIGH_WIND: {
                catalyst: { min: 0.35 },
                gradient: { min: 0.20 }
            },
            
            // Calm conditions
            FOG: {
                catalyst: { max: 0.25 },
                gradient: { max: 0.10 },
                fuel: { min: 0.20, max: 0.50 }
            },
            CLOUDY: {
                fuel: { min: 0.15 },
                gradient: { max: 0.20 }
            },
            PARTLY_CLOUDY: {
                fuel: { min: 0.10, max: 0.40 }
            },
            FAIR: {
                fuel: { max: 0.25 },
                gradient: { max: 0.15 },
                catalyst: { max: 0.30 }
            }
        };

        // Weather metadata
        this.weatherMeta = {
            TORNADO:        { severity: 10, icon: '🌪️', color: '#dc2626', category: 'severe' },
            SUPERCELL:      { severity: 9,  icon: '🌩️', color: '#ea580c', category: 'severe' },
            SEVERE_TSTORM:  { severity: 8,  icon: '⛈️', color: '#f59e0b', category: 'severe' },
            DERECHO:        { severity: 8,  icon: '💨', color: '#0891b2', category: 'severe' },
            BOMB_CYCLONE:   { severity: 8,  icon: '🌀', color: '#7c3aed', category: 'winter' },
            BLIZZARD:       { severity: 7,  icon: '🌨️', color: '#6366f1', category: 'winter' },
            ICE_STORM:      { severity: 7,  icon: '🧊', color: '#8b5cf6', category: 'winter' },
            WINTER_STORM:   { severity: 6,  icon: '❄️', color: '#3b82f6', category: 'winter' },
            HIGH_WIND:      { severity: 5,  icon: '🌬️', color: '#06b6d4', category: 'wind' },
            THUNDERSTORM:   { severity: 5,  icon: '⛈️', color: '#eab308', category: 'convective' },
            FREEZING_RAIN:  { severity: 5,  icon: '🌧️', color: '#a855f7', category: 'winter' },
            SNOW:           { severity: 4,  icon: '🌨️', color: '#60a5fa', category: 'winter' },
            WINTER_MIX:     { severity: 4,  icon: '🌨️', color: '#818cf8', category: 'winter' },
            SHOWERS:        { severity: 3,  icon: '🌦️', color: '#22c55e', category: 'rain' },
            RAIN:           { severity: 3,  icon: '🌧️', color: '#10b981', category: 'rain' },
            DRIZZLE:        { severity: 2,  icon: '🌧️', color: '#6ee7b7', category: 'rain' },
            FOG:            { severity: 2,  icon: '🌫️', color: '#9ca3af', category: 'visibility' },
            CLOUDY:         { severity: 1,  icon: '☁️', color: '#d1d5db', category: 'clouds' },
            PARTLY_CLOUDY:  { severity: 1,  icon: '⛅', color: '#e5e7eb', category: 'clouds' },
            FAIR:           { severity: 0,  icon: '☀️', color: '#fbbf24', category: 'clear' }
        };
    }

    /**
     * Check if factors meet threshold requirements
     */
    meetsThreshold(factors, threshold) {
        for (const [factor, limits] of Object.entries(threshold)) {
            if (factor === 'inversionMin' && factors.inversionRatio < limits) return false;
            if (factor === 'inversionMax' && factors.inversionRatio > limits) return false;
            
            if (typeof limits === 'object') {
                const value = factors[factor];
                if (value === undefined) continue;
                if (limits.min !== undefined && value < limits.min) return false;
                if (limits.max !== undefined && value > limits.max) return false;
            }
        }
        return true;
    }

    /**
     * Calculate match score for a weather type
     */
    calculateScore(factors, threshold) {
        let score = 0;
        let checks = 0;

        for (const [factor, limits] of Object.entries(threshold)) {
            if (factor.startsWith('inversion')) continue;
            if (typeof limits !== 'object') continue;
            
            const value = factors[factor];
            if (value === undefined) continue;

            checks++;
            
            // Score based on how well the value matches the typical range
            if (limits.typical !== undefined) {
                const distance = Math.abs(value - limits.typical);
                score += Math.max(0, 1 - distance);
            } else if (limits.min !== undefined && limits.max !== undefined) {
                const mid = (limits.min + limits.max) / 2;
                const range = limits.max - limits.min;
                const distance = Math.abs(value - mid) / range;
                score += Math.max(0, 1 - distance);
            } else if (limits.min !== undefined) {
                score += value >= limits.min ? (value - limits.min) / (1 - limits.min) : 0;
            } else if (limits.max !== undefined) {
                score += value <= limits.max ? (limits.max - value) / limits.max : 0;
            }
        }

        return checks > 0 ? score / checks : 0;
    }

    /**
     * Determine temperature regime based on solar angle and fuel
     */
    getTemperatureRegime(solarAngle, fuel) {
        // Low solar + low fuel = cold
        // High solar + high fuel = hot
        const tempScore = (solarAngle * 0.6) + (fuel * 0.4);
        
        if (tempScore < 0.35) return 'COLD';
        if (tempScore < 0.50) return 'COOL';
        if (tempScore < 0.65) return 'MILD';
        if (tempScore < 0.80) return 'WARM';
        return 'HOT';
    }

    /**
     * Main classification method
     */
    classify(factors) {
        const {
            catalyst,
            gradient,
            fuel,
            solarAngle,
            inversionRatio,
            danger
        } = factors;

        // Add danger to factors if not present
        const augmentedFactors = {
            ...factors,
            danger: danger || (fuel * gradient * Math.pow(catalyst, 2) * Math.pow(solarAngle, 2))
        };

        const tempRegime = this.getTemperatureRegime(solarAngle, fuel);
        const candidates = [];

        // Check each weather type
        for (const [type, threshold] of Object.entries(this.thresholds)) {
            if (this.meetsThreshold(augmentedFactors, threshold)) {
                const score = this.calculateScore(augmentedFactors, threshold);
                candidates.push({ type, score, threshold });
            }
        }

        // Sort by severity (descending) then score
        candidates.sort((a, b) => {
            const sevA = this.weatherMeta[a.type]?.severity || 0;
            const sevB = this.weatherMeta[b.type]?.severity || 0;
            if (sevB !== sevA) return sevB - sevA;
            return b.score - a.score;
        });

        // Determine primary and secondary predictions
        let primary = candidates[0]?.type || 'FAIR';
        let secondary = candidates[1]?.type || null;
        let confidence = candidates[0]?.score || 0.5;

        // Apply temperature regime adjustments
        if (tempRegime === 'COLD' || tempRegime === 'COOL') {
            // Prefer winter types in cold regime
            const winterCandidate = candidates.find(c => 
                this.weatherMeta[c.type]?.category === 'winter'
            );
            if (winterCandidate && winterCandidate.score > 0.3) {
                primary = winterCandidate.type;
            }
        }

        // Get metadata
        const meta = this.weatherMeta[primary] || this.weatherMeta.FAIR;

        return {
            primary,
            secondary,
            confidence: Math.min(1, confidence),
            severity: meta.severity,
            icon: meta.icon,
            color: meta.color,
            category: meta.category,
            tempRegime,
            allCandidates: candidates.slice(0, 5).map(c => ({
                type: c.type,
                score: c.score.toFixed(3),
                icon: this.weatherMeta[c.type]?.icon
            }))
        };
    }

    /**
     * Generate human-readable forecast text
     */
    generateForecast(factors, classification) {
        const { primary, secondary, tempRegime, severity } = classification;
        const meta = this.weatherMeta[primary];
        
        let forecast = '';
        
        // Temperature context
        const tempText = {
            'COLD': 'Cold conditions',
            'COOL': 'Cool temperatures',
            'MILD': 'Mild temperatures',
            'WARM': 'Warm conditions',
            'HOT': 'Hot temperatures'
        }[tempRegime];

        // Primary condition
        const conditionText = {
            'TORNADO': 'Tornado risk - seek shelter if warnings issued',
            'SUPERCELL': 'Supercell thunderstorms possible - stay weather aware',
            'SEVERE_TSTORM': 'Severe thunderstorms possible - damaging winds and large hail',
            'DERECHO': 'Derecho possible - widespread damaging winds',
            'BOMB_CYCLONE': 'Rapidly intensifying storm system - high winds and heavy precipitation',
            'BLIZZARD': 'Blizzard conditions - heavy snow, high winds, low visibility',
            'ICE_STORM': 'Ice storm - significant ice accumulation expected',
            'WINTER_STORM': 'Winter storm - accumulating snow and difficult travel',
            'HIGH_WIND': 'High winds expected - secure loose objects',
            'THUNDERSTORM': 'Thunderstorms expected',
            'FREEZING_RAIN': 'Freezing rain possible - hazardous travel',
            'SNOW': 'Snow expected',
            'WINTER_MIX': 'Wintry mix of precipitation',
            'SHOWERS': 'Scattered showers',
            'RAIN': 'Rain expected',
            'DRIZZLE': 'Light drizzle',
            'FOG': 'Foggy conditions - reduced visibility',
            'CLOUDY': 'Cloudy skies',
            'PARTLY_CLOUDY': 'Partly cloudy',
            'FAIR': 'Fair weather'
        }[primary];

        forecast = `${tempText}. ${conditionText}.`;

        // Add secondary if significant
        if (secondary && severity < 5) {
            const secMeta = this.weatherMeta[secondary];
            if (secMeta && secMeta.severity >= severity - 2) {
                forecast += ` ${secondary.replace('_', ' ').toLowerCase()} also possible.`;
            }
        }

        // Add mechanism explanation for severe weather
        if (severity >= 7) {
            forecast += ` [Catalyst: ${(factors.catalyst * 100).toFixed(0)}%, Gradient: ${(factors.gradient * 100).toFixed(0)}%]`;
        }

        return forecast;
    }

    /**
     * Get detailed breakdown of why this classification was chosen
     */
    explainClassification(factors, classification) {
        const { primary, allCandidates, tempRegime } = classification;
        const threshold = this.thresholds[primary];
        
        const explanation = {
            prediction: primary,
            temperatureRegime: tempRegime,
            factorAnalysis: {
                catalyst: {
                    value: (factors.catalyst * 100).toFixed(1) + '%',
                    interpretation: factors.catalyst > 0.7 ? 'High rotation potential (equinox)' :
                                   factors.catalyst > 0.4 ? 'Moderate rotation potential' :
                                   factors.catalyst > 0.2 ? 'Low rotation potential' :
                                   'Minimal rotation (near solstice)'
                },
                gradient: {
                    value: (factors.gradient * 100).toFixed(1) + '%',
                    interpretation: factors.gradient > 0.6 ? 'Strong thermal collision (air mass boundary)' :
                                   factors.gradient > 0.3 ? 'Moderate frontal activity' :
                                   'Weak or no frontal boundary'
                },
                fuel: {
                    value: (factors.fuel * 100).toFixed(1) + '%',
                    interpretation: factors.fuel > 0.6 ? 'High moisture/energy available' :
                                   factors.fuel > 0.3 ? 'Moderate moisture available' :
                                   'Limited moisture/energy'
                },
                solarAngle: {
                    value: (factors.solarAngle * 100).toFixed(1) + '%',
                    interpretation: factors.solarAngle > 0.8 ? 'Strong solar heating' :
                                   factors.solarAngle > 0.5 ? 'Moderate solar input' :
                                   'Weak solar input (winter/high latitude)'
                },
                inversionRatio: {
                    value: factors.inversionRatio.toFixed(2),
                    interpretation: factors.inversionRatio > 1.2 ? 'HORIZONTAL discharge mode (cyclonic)' :
                                   factors.inversionRatio > 1.0 ? 'Transitional mode' :
                                   'VERTICAL discharge mode (convective)'
                }
            },
            alternativePredictions: allCandidates,
            thresholdMatch: threshold
        };

        return explanation;
    }
}

// ═══════════════════════════════════════════════════════════════
//                    EXPORT
// ═══════════════════════════════════════════════════════════════

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DSOWeatherClassifier };
}
