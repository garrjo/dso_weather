/**
 * DSO Historical Validation Engine
 * Validates DSO model against NOAA Storm Events Database
 * 
 * Process:
 * 1. Load historical storm events (date, location, type)
 * 2. Calculate DSO factors for each event
 * 3. Map factor space to event types
 * 4. Derive empirical thresholds
 * 5. Report validation statistics
 * 
 * Author: Joe Garrett / VaultSync Solutions Inc.
 * © 2026
 */

// ═══════════════════════════════════════════════════════════════
//                    DSO FACTOR CALCULATIONS
// ═══════════════════════════════════════════════════════════════

class DSOFactorCalculator {
    constructor() {
        this.gulfSSTBaseline = 26.5;
    }

    getDayOfYear(dateStr) {
        const date = new Date(dateStr);
        const start = new Date(date.getFullYear(), 0, 0);
        return Math.floor((date - start) / (1000 * 60 * 60 * 24));
    }

    // Catalyst: Rate of Earth's tilt change (peaks at equinoxes)
    getCatalyst(dayOfYear) {
        const phase = (2 * Math.PI * (dayOfYear - 80)) / 365.25;
        const rawValue = 23.5 * (2 * Math.PI / 365.25) * Math.cos(phase);
        return Math.abs(rawValue) / 0.405;
    }

    // Solar declination
    getSolarDeclination(dayOfYear) {
        return 23.45 * Math.sin((2 * Math.PI / 365.25) * (dayOfYear - 81));
    }

    // Solar angle at latitude
    getSolarAngle(dayOfYear, latitude) {
        const declination = this.getSolarDeclination(dayOfYear);
        const decRad = declination * Math.PI / 180;
        const latRad = latitude * Math.PI / 180;
        const sinAlpha = Math.sin(latRad) * Math.sin(decRad) + 
                         Math.cos(latRad) * Math.cos(decRad);
        return Math.max(0, Math.min(1, sinAlpha));
    }

    // Gulf SST (seasonal variation)
    getGulfSST(dayOfYear) {
        const seasonalOffset = 3 * Math.sin((2 * Math.PI * (dayOfYear - 45)) / 365.25);
        return this.gulfSSTBaseline + seasonalOffset;
    }

    // E-Fuel based on Gulf SST and distance
    getFuel(dayOfYear, gulfDistanceKm) {
        const sst = this.getGulfSST(dayOfYear);
        const sstNorm = (sst - 20) / 12;
        const distanceDecay = Math.exp(-gulfDistanceKm / 1500);
        return Math.max(0, Math.min(1, sstNorm * distanceDecay * 1.5));
    }

    // E-Gradient (thermal collision zone intensity)
    getGradient(dayOfYear, gradientZone = 0.85) {
        const springPeak = Math.exp(-Math.pow((dayOfYear - 100) / 45, 2));
        const fallPeak = Math.exp(-Math.pow((dayOfYear - 290) / 50, 2)) * 0.7;
        return Math.max(springPeak, fallPeak) * gradientZone;
    }

    // Inversion ratio
    getInversionRatio(catalyst, solarAngle) {
        return catalyst / (solarAngle + 0.1);
    }

    // Calculate distance from Gulf of Mexico (approximate)
    getGulfDistance(lat, lon) {
        // Gulf center approximation: 25°N, 90°W
        const gulfLat = 25;
        const gulfLon = -90;
        const latDiff = lat - gulfLat;
        const lonDiff = lon - gulfLon;
        // Rough km conversion at mid-latitudes
        return Math.sqrt(Math.pow(latDiff * 111, 2) + Math.pow(lonDiff * 85, 2));
    }

    // Get gradient zone based on latitude (how much of the Arctic/Gulf collision affects this area)
    getGradientZone(lat) {
        // Peak gradient zone around 35-40°N (Tornado Alley)
        if (lat >= 33 && lat <= 42) return 1.0;
        if (lat >= 30 && lat < 33) return 0.85;
        if (lat >= 42 && lat <= 48) return 0.75;
        if (lat >= 25 && lat < 30) return 0.6;
        return 0.4;
    }

    // Calculate all factors for an event
    calculateFactors(dateStr, lat, lon) {
        const dayOfYear = this.getDayOfYear(dateStr);
        const gulfDistance = this.getGulfDistance(lat, lon);
        const gradientZone = this.getGradientZone(lat);

        const catalyst = this.getCatalyst(dayOfYear);
        const solarAngle = this.getSolarAngle(dayOfYear, lat);
        const fuel = this.getFuel(dayOfYear, gulfDistance);
        const gradient = this.getGradient(dayOfYear, gradientZone);
        const inversionRatio = this.getInversionRatio(catalyst, solarAngle);

        // Derived indices
        const probability = fuel * catalyst * solarAngle;
        const volatility = gradient * catalyst * solarAngle;
        const danger = fuel * gradient * Math.pow(catalyst, 2) * Math.pow(solarAngle, 2);

        return {
            dayOfYear,
            catalyst,
            solarAngle,
            fuel,
            gradient,
            inversionRatio,
            probability,
            volatility,
            danger,
            gulfDistance,
            gradientZone
        };
    }
}

// ═══════════════════════════════════════════════════════════════
//                    VALIDATION ENGINE
// ═══════════════════════════════════════════════════════════════

class DSOValidator {
    constructor() {
        this.calculator = new DSOFactorCalculator();
        this.eventTypes = {};
        this.factorDistributions = {};
    }

    // Map NOAA event types to DSO categories
    mapEventType(noaaType) {
        const type = noaaType.toUpperCase();
        
        if (type.includes('TORNADO')) return 'TORNADO';
        if (type.includes('THUNDERSTORM WIND') || type.includes('TSTM WIND')) return 'SEVERE_TSTORM';
        if (type.includes('HAIL')) return 'HAIL';
        if (type.includes('FLASH FLOOD')) return 'FLASH_FLOOD';
        if (type.includes('FLOOD')) return 'FLOOD';
        if (type.includes('WINTER STORM') || type.includes('BLIZZARD')) return 'WINTER_STORM';
        if (type.includes('ICE STORM')) return 'ICE_STORM';
        if (type.includes('HIGH WIND')) return 'HIGH_WIND';
        if (type.includes('HURRICANE') || type.includes('TROPICAL')) return 'HURRICANE';
        
        return 'OTHER';
    }

    // Process a single event
    processEvent(event) {
        const { date, lat, lon, eventType } = event;
        
        if (!lat || !lon || !date) return null;
        
        const factors = this.calculator.calculateFactors(date, lat, lon);
        const dsoType = this.mapEventType(eventType);

        return {
            ...factors,
            noaaType: eventType,
            dsoType,
            date,
            lat,
            lon
        };
    }

    // Aggregate statistics by event type
    aggregateByType(events) {
        const byType = {};

        events.forEach(e => {
            if (!e) return;
            
            if (!byType[e.dsoType]) {
                byType[e.dsoType] = {
                    count: 0,
                    catalyst: { sum: 0, min: 1, max: 0, values: [] },
                    gradient: { sum: 0, min: 1, max: 0, values: [] },
                    fuel: { sum: 0, min: 1, max: 0, values: [] },
                    solarAngle: { sum: 0, min: 1, max: 0, values: [] },
                    danger: { sum: 0, min: 1, max: 0, values: [] },
                    inversionRatio: { sum: 0, min: 100, max: 0, values: [] }
                };
            }

            const t = byType[e.dsoType];
            t.count++;

            ['catalyst', 'gradient', 'fuel', 'solarAngle', 'danger', 'inversionRatio'].forEach(f => {
                t[f].sum += e[f];
                t[f].min = Math.min(t[f].min, e[f]);
                t[f].max = Math.max(t[f].max, e[f]);
                t[f].values.push(e[f]);
            });
        });

        // Calculate means and percentiles
        Object.keys(byType).forEach(type => {
            const t = byType[type];
            ['catalyst', 'gradient', 'fuel', 'solarAngle', 'danger', 'inversionRatio'].forEach(f => {
                t[f].mean = t[f].sum / t.count;
                t[f].values.sort((a, b) => a - b);
                t[f].p25 = t[f].values[Math.floor(t[f].values.length * 0.25)];
                t[f].p75 = t[f].values[Math.floor(t[f].values.length * 0.75)];
                t[f].median = t[f].values[Math.floor(t[f].values.length * 0.5)];
                delete t[f].values; // Clean up
                delete t[f].sum;
            });
        });

        return byType;
    }

    // Generate calibration thresholds from data
    generateThresholds(aggregated) {
        const thresholds = {};

        Object.keys(aggregated).forEach(type => {
            const t = aggregated[type];
            thresholds[type] = {
                catalyst: { min: t.catalyst.p25, typical: t.catalyst.median, max: t.catalyst.p75 },
                gradient: { min: t.gradient.p25, typical: t.gradient.median, max: t.gradient.p75 },
                fuel: { min: t.fuel.p25, typical: t.fuel.median, max: t.fuel.p75 },
                solarAngle: { min: t.solarAngle.p25, typical: t.solarAngle.median, max: t.solarAngle.p75 },
                danger: { min: t.danger.p25, typical: t.danger.median, max: t.danger.p75 },
                inversionRatio: { min: t.inversionRatio.p25, typical: t.inversionRatio.median, max: t.inversionRatio.p75 },
                count: t.count
            };
        });

        return thresholds;
    }

    // Print validation report
    printReport(aggregated, thresholds) {
        console.log('\n' + '═'.repeat(80));
        console.log('DSO MODEL HISTORICAL VALIDATION REPORT');
        console.log('═'.repeat(80));

        const types = Object.keys(aggregated).sort((a, b) => aggregated[b].count - aggregated[a].count);

        types.forEach(type => {
            const t = aggregated[type];
            const th = thresholds[type];

            console.log(`\n┌─ ${type} (n=${t.count}) ${'─'.repeat(60 - type.length - String(t.count).length)}`);
            console.log('│');
            console.log('│  Factor        │  P25   │ Median │  P75   │   Min  │   Max  │');
            console.log('│  ──────────────┼────────┼────────┼────────┼────────┼────────┤');
            
            ['catalyst', 'gradient', 'fuel', 'solarAngle', 'danger'].forEach(f => {
                const d = t[f];
                console.log(`│  ${f.padEnd(14)}│ ${d.p25.toFixed(3).padStart(6)} │ ${d.median.toFixed(3).padStart(6)} │ ${d.p75.toFixed(3).padStart(6)} │ ${d.min.toFixed(3).padStart(6)} │ ${d.max.toFixed(3).padStart(6)} │`);
            });
            
            console.log('└' + '─'.repeat(70));
        });

        // Key findings
        console.log('\n' + '═'.repeat(80));
        console.log('KEY FINDINGS');
        console.log('═'.repeat(80));

        if (aggregated.TORNADO && aggregated.SEVERE_TSTORM) {
            const tornado = aggregated.TORNADO;
            const tstorm = aggregated.SEVERE_TSTORM;
            
            console.log(`\nTORNADO vs SEVERE_TSTORM:`);
            console.log(`  Catalyst:  Tornado median ${tornado.catalyst.median.toFixed(3)} vs T-Storm ${tstorm.catalyst.median.toFixed(3)}`);
            console.log(`  Gradient:  Tornado median ${tornado.gradient.median.toFixed(3)} vs T-Storm ${tstorm.gradient.median.toFixed(3)}`);
            console.log(`  Danger:    Tornado median ${tornado.danger.median.toFixed(4)} vs T-Storm ${tstorm.danger.median.toFixed(4)}`);
        }

        if (aggregated.WINTER_STORM) {
            const winter = aggregated.WINTER_STORM;
            console.log(`\nWINTER_STORM:`);
            console.log(`  Inversion Ratio median: ${winter.inversionRatio.median.toFixed(3)} (>1.2 = horizontal discharge mode)`);
            console.log(`  Catalyst median: ${winter.catalyst.median.toFixed(3)}`);
            console.log(`  Solar Angle median: ${winter.solarAngle.median.toFixed(3)}`);
        }
    }
}

// ═══════════════════════════════════════════════════════════════
//                    SAMPLE DATA FOR TESTING
// ═══════════════════════════════════════════════════════════════

// Representative sample of real tornado events for validation
const sampleTornadoEvents = [
    // April 2011 Super Outbreak
    { date: '2011-04-27', lat: 34.8, lon: -87.6, eventType: 'Tornado' },
    { date: '2011-04-27', lat: 33.2, lon: -87.5, eventType: 'Tornado' },
    { date: '2011-04-27', lat: 35.1, lon: -86.2, eventType: 'Tornado' },
    
    // May 2013 Moore, OK
    { date: '2013-05-20', lat: 35.3, lon: -97.5, eventType: 'Tornado' },
    
    // May 2011 Joplin, MO
    { date: '2011-05-22', lat: 37.1, lon: -94.5, eventType: 'Tornado' },
    
    // April 2020 Easter outbreak
    { date: '2020-04-12', lat: 33.5, lon: -86.8, eventType: 'Tornado' },
    { date: '2020-04-12', lat: 34.2, lon: -88.1, eventType: 'Tornado' },
    
    // March 2022 outbreak
    { date: '2022-03-30', lat: 35.5, lon: -97.0, eventType: 'Tornado' },
    
    // Spring tornadoes - various years
    { date: '2019-05-25', lat: 35.2, lon: -97.4, eventType: 'Tornado' },
    { date: '2018-04-15', lat: 34.5, lon: -92.5, eventType: 'Tornado' },
    { date: '2017-04-29', lat: 36.1, lon: -95.8, eventType: 'Tornado' },
    { date: '2016-05-09', lat: 35.8, lon: -98.2, eventType: 'Tornado' },
    { date: '2015-05-06', lat: 35.4, lon: -97.6, eventType: 'Tornado' },
    
    // Fall tornadoes
    { date: '2020-10-10', lat: 33.8, lon: -88.5, eventType: 'Tornado' },
    { date: '2019-10-20', lat: 32.8, lon: -97.3, eventType: 'Tornado' },
    
    // Summer tornadoes (should show lower catalyst)
    { date: '2019-07-15', lat: 41.2, lon: -96.1, eventType: 'Tornado' },
    { date: '2018-06-28', lat: 40.8, lon: -95.9, eventType: 'Tornado' },
];

const sampleSevereStormEvents = [
    { date: '2020-08-10', lat: 41.5, lon: -93.6, eventType: 'Thunderstorm Wind' },
    { date: '2020-08-10', lat: 42.0, lon: -91.5, eventType: 'Thunderstorm Wind' },
    { date: '2019-07-19', lat: 40.8, lon: -96.7, eventType: 'Thunderstorm Wind' },
    { date: '2021-06-25', lat: 39.5, lon: -98.3, eventType: 'Thunderstorm Wind' },
    { date: '2022-07-05', lat: 38.9, lon: -94.7, eventType: 'Thunderstorm Wind' },
    { date: '2020-05-20', lat: 35.2, lon: -97.5, eventType: 'Thunderstorm Wind' },
    { date: '2019-04-13', lat: 34.0, lon: -86.5, eventType: 'Thunderstorm Wind' },
    { date: '2018-05-01', lat: 36.1, lon: -95.8, eventType: 'Thunderstorm Wind' },
];

const sampleWinterStormEvents = [
    { date: '2021-02-15', lat: 32.8, lon: -96.8, eventType: 'Winter Storm' },
    { date: '2022-01-22', lat: 35.5, lon: -86.5, eventType: 'Winter Storm' },
    { date: '2020-12-16', lat: 40.7, lon: -74.0, eventType: 'Winter Storm' },
    { date: '2019-11-26', lat: 42.3, lon: -83.0, eventType: 'Winter Storm' },
    { date: '2021-01-26', lat: 40.0, lon: -75.1, eventType: 'Blizzard' },
    { date: '2022-02-03', lat: 41.8, lon: -87.6, eventType: 'Winter Storm' },
    { date: '2023-12-17', lat: 39.1, lon: -84.5, eventType: 'Winter Storm' },
];

const sampleDerechoEvents = [
    // August 2020 Midwest Derecho
    { date: '2020-08-10', lat: 41.6, lon: -93.6, eventType: 'Thunderstorm Wind' },
    { date: '2020-08-10', lat: 42.0, lon: -90.6, eventType: 'Thunderstorm Wind' },
    // June 2012 Derecho
    { date: '2012-06-29', lat: 39.0, lon: -84.5, eventType: 'Thunderstorm Wind' },
    { date: '2012-06-29', lat: 38.9, lon: -77.0, eventType: 'Thunderstorm Wind' },
];

// ═══════════════════════════════════════════════════════════════
//                    RUN VALIDATION
// ═══════════════════════════════════════════════════════════════

function runValidation() {
    const validator = new DSOValidator();
    
    // Combine all sample events
    const allEvents = [
        ...sampleTornadoEvents,
        ...sampleSevereStormEvents,
        ...sampleWinterStormEvents,
        ...sampleDerechoEvents
    ];

    console.log('Processing', allEvents.length, 'historical events...\n');

    // Process each event
    const processed = allEvents.map(e => validator.processEvent(e));
    
    // Show individual tornado events
    console.log('═'.repeat(80));
    console.log('INDIVIDUAL TORNADO EVENT FACTORS');
    console.log('═'.repeat(80));
    console.log('\nDate       │ Catalyst │ Gradient │  Fuel   │ Danger   │ Note');
    console.log('───────────┼──────────┼──────────┼─────────┼──────────┼─────────────');
    
    processed.filter(e => e && e.dsoType === 'TORNADO').forEach(e => {
        let note = '';
        if (e.catalyst > 0.8) note = 'High catalyst ✓';
        else if (e.catalyst < 0.3) note = 'Low catalyst (summer)';
        
        console.log(
            `${e.date} │ ${(e.catalyst * 100).toFixed(1).padStart(6)}%  │ ${(e.gradient * 100).toFixed(1).padStart(6)}%  │ ${(e.fuel * 100).toFixed(1).padStart(5)}%  │ ${e.danger.toFixed(5).padStart(8)} │ ${note}`
        );
    });

    // Aggregate by type
    const aggregated = validator.aggregateByType(processed);
    
    // Generate thresholds
    const thresholds = validator.generateThresholds(aggregated);
    
    // Print report
    validator.printReport(aggregated, thresholds);

    // Output calibrated thresholds as JSON
    console.log('\n' + '═'.repeat(80));
    console.log('CALIBRATED THRESHOLDS (for classifier)');
    console.log('═'.repeat(80));
    console.log(JSON.stringify(thresholds, null, 2));
}

// Run if called directly
if (typeof require !== 'undefined' && require.main === module) {
    runValidation();
}

module.exports = { DSOFactorCalculator, DSOValidator };
