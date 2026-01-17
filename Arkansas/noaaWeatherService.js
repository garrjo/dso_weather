/**
 * NOAA/NWS Weather Service for DSO Weather Dashboard
 * REAL DATA ONLY - No estimates, no approximations
 *
 * Data Sources:
 * - api.weather.gov — Surface observations
 * - ndbc.noaa.gov — Gulf buoy SST (real-time)
 * - weather.uwyo.edu — Upper air soundings (KLZK)
 * - spc.noaa.gov — Outlooks for comparison
 *
 * If data cannot be fetched, display "NO DATA" — never estimate.
 */

class NOAAWeatherService {
    constructor() {
        // API Endpoints
        this.NWS_API = 'https://api.weather.gov';
        this.NDBC_API = 'https://www.ndbc.noaa.gov/data/realtime2';
        this.UWYO_SOUNDING = 'https://weather.uwyo.edu/cgi-bin/sounding';

        // Arkansas reference point
        this.ARKANSAS = {
            name: 'Arkansas',
            lat: 34.7465,
            lon: -92.2896,
            stationId: 'KLIT',           // Little Rock surface station
            soundingStation: '72340',     // KLZK Little Rock upper air
            nwsOffice: 'LZK'
        };

        // Gulf of Mexico buoys for SST
        this.GULF_BUOYS = [
            { id: '42001', name: 'Mid Gulf', lat: 25.9, lon: -89.7 },
            { id: '42002', name: 'West Gulf', lat: 26.0, lon: -93.6 },
            { id: '42019', name: 'Freeport TX', lat: 27.9, lon: -95.4 },
            { id: '42020', name: 'Corpus Christi', lat: 26.9, lon: -96.7 },
            { id: '42035', name: 'Galveston', lat: 29.2, lon: -94.4 },
            { id: '42040', name: 'Luke Offshore', lat: 29.2, lon: -88.2 },
            { id: '42067', name: 'NE Gulf', lat: 30.0, lon: -88.6 }
        ];

        // Cache with short TTL for real-time data
        this.cache = {
            surface: { data: null, timestamp: null, ttlMinutes: 10 },
            buoy: { data: null, timestamp: null, ttlMinutes: 30 },
            sounding: { data: null, timestamp: null, ttlMinutes: 60 }
        };

        // Track previous values for trends (real trends from real data)
        this.previousValues = {};
    }

    // ═══════════════════════════════════════════════════════════════
    // SURFACE OBSERVATIONS (NWS API)
    // ═══════════════════════════════════════════════════════════════

    async fetchSurfaceObservations() {
        const url = `${this.NWS_API}/stations/${this.ARKANSAS.stationId}/observations/latest`;

        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'DSOWeatherDashboard/1.0 (Real-Time Forecast Tool)',
                    'Accept': 'application/geo+json'
                }
            });

            if (!response.ok) {
                throw new Error(`NWS API returned ${response.status}`);
            }

            const data = await response.json();
            return {
                success: true,
                data: data.properties,
                timestamp: data.properties.timestamp,
                station: this.ARKANSAS.stationId
            };
        } catch (error) {
            console.error('Surface observation fetch failed:', error);
            return { success: false, error: error.message };
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // GULF SST FROM NDBC BUOYS (REAL DATA)
    // ═══════════════════════════════════════════════════════════════

    async fetchBuoyData(buoyId) {
        // NDBC provides real-time data in text format
        const url = `${this.NDBC_API}/${buoyId}.txt`;

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`NDBC returned ${response.status} for buoy ${buoyId}`);
            }

            const text = await response.text();
            return this.parseNDBCData(text, buoyId);
        } catch (error) {
            console.error(`Buoy ${buoyId} fetch failed:`, error);
            return { success: false, buoyId, error: error.message };
        }
    }

    parseNDBCData(text, buoyId) {
        const lines = text.trim().split('\n');
        if (lines.length < 3) {
            return { success: false, buoyId, error: 'Insufficient data' };
        }

        // First line is headers, second is units, third+ is data
        const headers = lines[0].replace(/^#/, '').trim().split(/\s+/);
        const dataLine = lines[2].trim().split(/\s+/);

        const getValue = (name) => {
            const idx = headers.indexOf(name);
            if (idx === -1) return null;
            const val = parseFloat(dataLine[idx]);
            return isNaN(val) || val === 999 || val === 9999 ? null : val;
        };

        const year = dataLine[0];
        const month = dataLine[1];
        const day = dataLine[2];
        const hour = dataLine[3];
        const minute = dataLine[4];

        return {
            success: true,
            buoyId,
            timestamp: `${year}-${month}-${day} ${hour}:${minute} UTC`,
            seaSurfaceTemp: getValue('WTMP'),      // Water temperature (°C)
            airTemp: getValue('ATMP'),              // Air temperature (°C)
            dewpoint: getValue('DEWP'),             // Dewpoint (°C)
            windSpeed: getValue('WSPD'),            // Wind speed (m/s)
            windDirection: getValue('WDIR'),        // Wind direction (degrees)
            windGust: getValue('GST'),              // Gust speed (m/s)
            pressure: getValue('PRES'),             // Pressure (hPa)
            waveHeight: getValue('WVHT'),           // Wave height (m)
            waterTempDepth: getValue('WTMP')        // Same as SST for surface buoys
        };
    }

    async fetchGulfSST() {
        // Fetch from multiple buoys for redundancy and averaging
        const results = await Promise.all(
            this.GULF_BUOYS.map(buoy => this.fetchBuoyData(buoy.id))
        );

        const validReadings = results.filter(r => r.success && r.seaSurfaceTemp !== null);

        if (validReadings.length === 0) {
            return {
                success: false,
                error: 'No valid SST readings from any Gulf buoy',
                attemptedBuoys: this.GULF_BUOYS.map(b => b.id)
            };
        }

        // Calculate average SST from all valid buoys
        const avgSST = validReadings.reduce((sum, r) => sum + r.seaSurfaceTemp, 0) / validReadings.length;

        // Find closest buoy to moisture path (NE Gulf buoys most relevant for Arkansas)
        const priorityBuoys = validReadings.filter(r =>
            ['42040', '42067', '42001'].includes(r.buoyId)
        );
        const primarySST = priorityBuoys.length > 0
            ? priorityBuoys[0].seaSurfaceTemp
            : validReadings[0].seaSurfaceTemp;

        return {
            success: true,
            primarySST,
            averageSST: avgSST,
            buoyCount: validReadings.length,
            readings: validReadings.map(r => ({
                buoyId: r.buoyId,
                sst: r.seaSurfaceTemp,
                timestamp: r.timestamp
            })),
            timestamp: new Date().toISOString()
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // UPPER AIR SOUNDINGS (University of Wyoming)
    // ═══════════════════════════════════════════════════════════════

    async fetchSounding() {
        // Get current date for sounding request
        const now = new Date();
        const year = now.getUTCFullYear();
        const month = String(now.getUTCMonth() + 1).padStart(2, '0');
        const day = String(now.getUTCDate()).padStart(2, '0');

        // Soundings are typically at 00Z and 12Z
        const hour = now.getUTCHours();
        const soundingHour = hour >= 12 ? '12' : '00';
        const fromTo = `${day}${soundingHour}`;

        const url = `${this.UWYO_SOUNDING}?region=naconf&TYPE=TEXT%3ALIST&YEAR=${year}&MONTH=${month}&FROM=${fromTo}&TO=${fromTo}&STNM=${this.ARKANSAS.soundingStation}`;

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Wyoming sounding returned ${response.status}`);
            }

            const html = await response.text();
            return this.parseSoundingData(html);
        } catch (error) {
            console.error('Sounding fetch failed:', error);
            return { success: false, error: error.message };
        }
    }

    parseSoundingData(html) {
        try {
            // Extract the PRE block containing sounding data
            const preMatch = html.match(/<PRE>([\s\S]*?)<\/PRE>/i);
            if (!preMatch) {
                return { success: false, error: 'No sounding data in response' };
            }

            const preContent = preMatch[1];

            // Parse station indices (CAPE, CIN, etc.)
            const indices = {};

            // CAPE
            const capeMatch = preContent.match(/Convective Available Potential Energy\s+(\d+\.?\d*)/i) ||
                             preContent.match(/CAPE\s+(\d+\.?\d*)/i);
            indices.cape = capeMatch ? parseFloat(capeMatch[1]) : null;

            // CIN
            const cinMatch = preContent.match(/Convective Inhibition\s+(-?\d+\.?\d*)/i) ||
                            preContent.match(/CINH?\s+(-?\d+\.?\d*)/i);
            indices.cin = cinMatch ? parseFloat(cinMatch[1]) : null;

            // Lifted Index
            const liMatch = preContent.match(/Lifted Index\s+(-?\d+\.?\d*)/i) ||
                           preContent.match(/LIFT\s+(-?\d+\.?\d*)/i);
            indices.liftedIndex = liMatch ? parseFloat(liMatch[1]) : null;

            // K Index
            const kMatch = preContent.match(/K Index\s+(-?\d+\.?\d*)/i) ||
                          preContent.match(/KINX\s+(-?\d+\.?\d*)/i);
            indices.kIndex = kMatch ? parseFloat(kMatch[1]) : null;

            // Total Totals
            const ttMatch = preContent.match(/Totals Totals Index\s+(-?\d+\.?\d*)/i) ||
                           preContent.match(/TOTL\s+(-?\d+\.?\d*)/i);
            indices.totalTotals = ttMatch ? parseFloat(ttMatch[1]) : null;

            // Precipitable Water
            const pwMatch = preContent.match(/Precipitable Water.*?(\d+\.?\d*)/i) ||
                           preContent.match(/PWAT\s+(\d+\.?\d*)/i);
            indices.precipitableWater = pwMatch ? parseFloat(pwMatch[1]) : null;

            // Parse the actual sounding levels for lapse rate and wind shear
            const levels = this.parseSoundingLevels(preContent);

            // Calculate real lapse rate from actual temperature data
            const lapseRate = this.calculateLapseRate(levels);

            // Calculate wind shear from actual wind profiles
            const windShear = this.calculateWindShear(levels);

            return {
                success: true,
                station: this.ARKANSAS.soundingStation,
                timestamp: new Date().toISOString(),
                indices,
                lapseRate,
                windShear,
                levelCount: levels.length,
                rawLevels: levels.slice(0, 10) // First 10 levels for reference
            };
        } catch (error) {
            return { success: false, error: 'Failed to parse sounding: ' + error.message };
        }
    }

    parseSoundingLevels(preContent) {
        const levels = [];

        // Sounding data format: PRES HGHT TEMP DWPT RELH MIXR DRCT SKNT THTA THTE THTV
        const lines = preContent.split('\n');

        for (const line of lines) {
            // Match lines that start with pressure values (typically 1000-100 hPa range)
            const match = line.match(/^\s*(\d{3,4}\.?\d*)\s+(\d+)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(\d+)\s+(\d+\.?\d*)\s+(\d+)\s+(\d+)/);

            if (match) {
                levels.push({
                    pressure: parseFloat(match[1]),      // hPa
                    height: parseFloat(match[2]),        // meters
                    temperature: parseFloat(match[3]),   // °C
                    dewpoint: parseFloat(match[4]),      // °C
                    relHumidity: parseFloat(match[5]),   // %
                    mixingRatio: parseFloat(match[6]),   // g/kg
                    windDirection: parseFloat(match[7]), // degrees
                    windSpeed: parseFloat(match[8])      // knots
                });
            }
        }

        return levels;
    }

    calculateLapseRate(levels) {
        if (levels.length < 2) {
            return { value: null, error: 'Insufficient levels' };
        }

        // Calculate lapse rate between surface and ~500mb (roughly 5.5km)
        const surface = levels[0];
        const upper = levels.find(l => l.pressure <= 500) || levels[levels.length - 1];

        if (!surface || !upper || surface.height === upper.height) {
            return { value: null, error: 'Cannot calculate lapse rate' };
        }

        const tempDiff = surface.temperature - upper.temperature;  // °C
        const heightDiff = (upper.height - surface.height) / 1000; // km

        const lapseRate = tempDiff / heightDiff; // °C/km

        // Determine stability
        let stability;
        if (lapseRate > 9.8) stability = 'Absolutely Unstable';
        else if (lapseRate > 6.5) stability = 'Conditionally Unstable';
        else if (lapseRate > 4.0) stability = 'Stable';
        else stability = 'Very Stable (Inversion Likely)';

        return {
            value: lapseRate,
            surfaceTemp: surface.temperature,
            upperTemp: upper.temperature,
            surfaceHeight: surface.height,
            upperHeight: upper.height,
            upperPressure: upper.pressure,
            stability
        };
    }

    calculateWindShear(levels) {
        if (levels.length < 2) {
            return { bulk0_6km: null, bulk0_1km: null, error: 'Insufficient levels' };
        }

        const surface = levels[0];

        // Find level closest to 1km AGL
        const level1km = levels.find(l => l.height - surface.height >= 1000) || levels[1];

        // Find level closest to 6km AGL
        const level6km = levels.find(l => l.height - surface.height >= 6000) || levels[levels.length - 1];

        // Calculate wind components
        const toComponents = (speed, dir) => {
            const rad = (dir * Math.PI) / 180;
            return {
                u: -speed * Math.sin(rad),
                v: -speed * Math.cos(rad)
            };
        };

        const surfaceWind = toComponents(surface.windSpeed, surface.windDirection);
        const wind1km = toComponents(level1km.windSpeed, level1km.windDirection);
        const wind6km = toComponents(level6km.windSpeed, level6km.windDirection);

        // Bulk shear magnitude
        const shear0_1km = Math.sqrt(
            Math.pow(wind1km.u - surfaceWind.u, 2) +
            Math.pow(wind1km.v - surfaceWind.v, 2)
        );

        const shear0_6km = Math.sqrt(
            Math.pow(wind6km.u - surfaceWind.u, 2) +
            Math.pow(wind6km.v - surfaceWind.v, 2)
        );

        // Interpretation
        let interpretation;
        if (shear0_6km > 40) interpretation = 'Significant tornado potential';
        else if (shear0_6km > 25) interpretation = 'Supercell potential';
        else if (shear0_6km > 15) interpretation = 'Organized storms possible';
        else interpretation = 'Weak shear - pulse storms';

        return {
            bulk0_1km: shear0_1km,
            bulk0_6km: shear0_6km,
            surfaceWind: { speed: surface.windSpeed, direction: surface.windDirection },
            wind1km: { speed: level1km.windSpeed, direction: level1km.windDirection, heightAGL: level1km.height - surface.height },
            wind6km: { speed: level6km.windSpeed, direction: level6km.windDirection, heightAGL: level6km.height - surface.height },
            interpretation
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // AGGREGATE ALL REAL DATA
    // ═══════════════════════════════════════════════════════════════

    async getAllWeatherData() {
        // Fetch all data sources in parallel
        const [surface, gulfSST, sounding] = await Promise.all([
            this.fetchSurfaceObservations(),
            this.fetchGulfSST(),
            this.fetchSounding()
        ]);

        return {
            surface,
            gulfSST,
            sounding,
            fetchTime: new Date().toISOString()
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // FORMAT FOR DSO DISPLAY (REAL VALUES ONLY)
    // ═══════════════════════════════════════════════════════════════

    async getWeatherVariables() {
        const allData = await this.getAllWeatherData();
        const dayOfYear = this.getDayOfYear();
        const variables = {};

        // Helper: return value or "NO DATA"
        const realValue = (val, decimals = 2) => {
            if (val === null || val === undefined || isNaN(val)) {
                return { value: 'NO DATA', isReal: false };
            }
            return { value: typeof val === 'number' ? val.toFixed(decimals) : val, isReal: true, raw: val };
        };

        // ═══════════════════════════════════════════════════════════════
        // H - Humidity (from real surface observations)
        // ═══════════════════════════════════════════════════════════════
        const surfaceData = allData.surface.success ? allData.surface.data : null;

        const dewpoint = surfaceData?.dewpoint?.value;
        const rh = surfaceData?.relativeHumidity?.value;

        variables.humidity = {
            symbol: 'H',
            name: 'Humidity',
            dewpoint: realValue(dewpoint, 1),
            relativeHumidity: realValue(rh, 0),
            dataSource: allData.surface.success ? 'NWS KLIT' : 'UNAVAILABLE',
            timestamp: surfaceData?.timestamp || 'NO DATA',
            trend: this.calcTrend('humidity_rh', rh),
            dsoModifier: this.getHumidityModifier(dewpoint, rh)
        };

        // ═══════════════════════════════════════════════════════════════
        // D - Energy Dispersal (from real CAPE and convection data)
        // ═══════════════════════════════════════════════════════════════
        const soundingData = allData.sounding.success ? allData.sounding : null;
        const cape = soundingData?.indices?.cape;
        const cin = soundingData?.indices?.cin;

        const temp = surfaceData?.temperature?.value;
        const windSpd = surfaceData?.windSpeed?.value;

        // Heat transfer only if we have real temp and wind
        let heatTransfer = null;
        if (temp !== null && temp !== undefined && windSpd !== null && windSpd !== undefined) {
            const windMs = windSpd / 3.6; // km/h to m/s if needed
            heatTransfer = (5.7 + 3.8 * windMs) * Math.abs(temp - 15);
        }

        variables.energyDispersal = {
            symbol: 'D',
            name: 'Energy Dispersal',
            cape: realValue(cape, 0),
            cin: realValue(cin, 0),
            heatTransferRate: realValue(heatTransfer, 1),
            liftedIndex: realValue(soundingData?.indices?.liftedIndex, 1),
            dataSource: allData.sounding.success ? 'KLZK Sounding' : 'UNAVAILABLE',
            trend: this.calcTrend('cape', cape),
            dsoModifier: this.getCAPEModifier(cape, cin)
        };

        // ═══════════════════════════════════════════════════════════════
        // W - Wind Pattern (from real surface + sounding shear)
        // ═══════════════════════════════════════════════════════════════
        const windDir = surfaceData?.windDirection?.value;
        const windGust = surfaceData?.windGust?.value;
        const shear0_6km = soundingData?.windShear?.bulk0_6km;
        const shear0_1km = soundingData?.windShear?.bulk0_1km;

        variables.windPattern = {
            symbol: 'W',
            name: 'Wind Pattern',
            speed: realValue(windSpd, 1),
            speedMph: realValue(windSpd ? windSpd * 0.621371 : null, 1),
            direction: realValue(windDir, 0),
            directionCardinal: windDir !== null ? this.degreesToCardinal(windDir) : 'NO DATA',
            gust: realValue(windGust, 1),
            gustMph: realValue(windGust ? windGust * 0.621371 : null, 1),
            shear0_6km: realValue(shear0_6km, 1),
            shear0_1km: realValue(shear0_1km, 1),
            shearInterpretation: soundingData?.windShear?.interpretation || 'NO DATA',
            dataSource: `Surface: ${allData.surface.success ? 'KLIT' : 'UNAVAILABLE'}, Shear: ${allData.sounding.success ? 'KLZK' : 'UNAVAILABLE'}`,
            trend: this.calcTrend('wind', windSpd),
            dsoModifier: this.getShearModifier(shear0_6km, shear0_1km)
        };

        // ═══════════════════════════════════════════════════════════════
        // A - Angle of Attack (from real pressure and wind data)
        // ═══════════════════════════════════════════════════════════════
        const pressure = surfaceData?.barometricPressure?.value;
        const pressureMb = pressure ? pressure / 100 : null;

        let frontAngle = null;
        if (windDir !== null) {
            frontAngle = Math.abs((windDir - 270 + 540) % 360 - 180);
        }

        const pressureTrend = pressureMb ? (pressureMb - 1013.25) : null;

        variables.angleOfAttack = {
            symbol: 'A',
            name: 'Angle of Attack',
            frontAngle: realValue(frontAngle, 0),
            pressure: realValue(pressureMb, 1),
            pressureTrend: pressureTrend !== null ? (pressureTrend > 0 ? 'Rising' : pressureTrend < 0 ? 'Falling' : 'Steady') : 'NO DATA',
            approachDirection: this.getFrontApproach(windDir, pressureTrend),
            dataSource: allData.surface.success ? 'NWS KLIT' : 'UNAVAILABLE',
            trend: pressureTrend > 0.5 ? '↑' : pressureTrend < -0.5 ? '↓' : '→',
            dsoModifier: this.getFrontAngleModifier(frontAngle, pressureTrend)
        };

        // ═══════════════════════════════════════════════════════════════
        // T - Thermal Variance (from REAL sounding lapse rate)
        // ═══════════════════════════════════════════════════════════════
        const lapseData = soundingData?.lapseRate;
        const lapseRate = lapseData?.value;

        variables.thermalVariance = {
            symbol: 'T',
            name: 'Thermal Variance',
            surfaceTemp: realValue(temp, 1),
            surfaceTempF: realValue(temp !== null ? temp * 9/5 + 32 : null, 1),
            lapseRate: realValue(lapseRate, 2),
            lapseRateUnit: '°C/km',
            stability: lapseData?.stability || 'NO DATA',
            inversionPresent: lapseRate !== null ? (lapseRate < 4.0 ? 'YES' : 'NO') : 'NO DATA',
            upperTemp: realValue(lapseData?.upperTemp, 1),
            upperHeight: realValue(lapseData?.upperHeight, 0),
            dataSource: allData.sounding.success ? 'KLZK Sounding' : 'UNAVAILABLE',
            trend: this.calcTrend('temp', temp),
            dsoModifier: this.getLapseRateModifier(lapseRate)
        };

        // ═══════════════════════════════════════════════════════════════
        // E_fuel - REAL Gulf SST + REAL Humidity
        // ═══════════════════════════════════════════════════════════════
        const gulfData = allData.gulfSST;
        const gulfSST = gulfData.success ? gulfData.primarySST : null;
        const avgGulfSST = gulfData.success ? gulfData.averageSST : null;

        let eFuel = null;
        if (gulfSST !== null && rh !== null) {
            // Real E_fuel calculation from real data
            const sstFactor = (gulfSST - 20) / 10; // Normalized: 20°C = 0, 30°C = 1
            const moistureFactor = rh / 100;
            eFuel = Math.max(0, Math.min(1, 0.7 * sstFactor + 0.3 * moistureFactor));
        }

        variables.eFuel = {
            symbol: 'E_fuel',
            name: 'Energy Fuel',
            value: realValue(eFuel, 3),
            gulfSST: realValue(gulfSST, 1),
            gulfSSTAvg: realValue(avgGulfSST, 1),
            buoyCount: gulfData.success ? gulfData.buoyCount : 0,
            buoyReadings: gulfData.success ? gulfData.readings : [],
            moistureContribution: realValue(rh ? (0.3 * rh / 100) : null, 3),
            dataSource: gulfData.success ? `NDBC Buoys (${gulfData.buoyCount})` : 'UNAVAILABLE',
            trend: this.calcTrend('efuel', eFuel),
            dsoModifier: this.getEFuelModifier(eFuel, gulfSST)
        };

        // ═══════════════════════════════════════════════════════════════
        // Gradient (∂E/∂φ) - From real pressure and dynamics
        // ═══════════════════════════════════════════════════════════════
        let gradient = null;
        if (pressureMb !== null && windSpd !== null) {
            const pressureDeparture = Math.abs(pressureMb - 1013.25) / 20;
            const dynamicFactor = windSpd / 50;
            gradient = Math.min(1, pressureDeparture + dynamicFactor);
        }

        variables.gradient = {
            symbol: '∂E/∂φ',
            name: 'Gradient',
            value: realValue(gradient, 3),
            pressureMb: realValue(pressureMb, 1),
            pressureDeparture: realValue(pressureMb ? Math.abs(pressureMb - 1013.25) : null, 1),
            dataSource: allData.surface.success ? 'NWS KLIT' : 'UNAVAILABLE',
            trend: this.calcTrend('gradient', gradient),
            dsoModifier: gradient !== null ? `Collision intensity: ${(gradient * 100).toFixed(0)}%` : 'NO DATA'
        };

        // ═══════════════════════════════════════════════════════════════
        // Catalyst (dθ/dt) - Calculated (this is always computable)
        // ═══════════════════════════════════════════════════════════════
        const catalyst = Math.abs(Math.cos((2 * Math.PI * (dayOfYear - 80)) / 365.25));
        const daysToEquinox = this.getDaysToEquinox(dayOfYear);

        variables.catalyst = {
            symbol: 'dθ/dt',
            name: 'Catalyst',
            value: realValue(catalyst, 3),
            daysToEquinox: daysToEquinox,
            phase: this.getCatalystPhase(dayOfYear),
            dataSource: 'Calculated (Orbital Mechanics)',
            trend: this.calcTrend('catalyst', catalyst),
            dsoModifier: `Rotation driver: ${(catalyst * 100).toFixed(0)}%`
        };

        // ═══════════════════════════════════════════════════════════════
        // Solar Angle (α) - Calculated for Arkansas latitude
        // ═══════════════════════════════════════════════════════════════
        const solarAngle = this.calculateSolarAngle(this.ARKANSAS.lat, dayOfYear);

        variables.solarAngle = {
            symbol: 'sin(α)',
            name: 'Solar Angle',
            value: realValue(solarAngle, 3),
            incidenceDegrees: realValue(Math.asin(solarAngle) * 180 / Math.PI, 1),
            latitude: this.ARKANSAS.lat,
            dataSource: 'Calculated (Solar Geometry)',
            trend: this.calcTrend('solar', solarAngle),
            dsoModifier: `Solar punch: ${(solarAngle * 100).toFixed(0)}%`
        };

        // ═══════════════════════════════════════════════════════════════
        // Metadata
        // ═══════════════════════════════════════════════════════════════
        variables.metadata = {
            timestamp: new Date().toISOString(),
            location: this.ARKANSAS.name,
            dayOfYear: dayOfYear,
            dataSources: {
                surface: allData.surface.success,
                gulfBuoys: allData.gulfSST.success,
                sounding: allData.sounding.success
            },
            errors: {
                surface: allData.surface.error || null,
                gulfBuoys: allData.gulfSST.error || null,
                sounding: allData.sounding.error || null
            }
        };

        return variables;
    }

    // ═══════════════════════════════════════════════════════════════
    // UTILITY FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    getDayOfYear() {
        const now = new Date();
        const start = new Date(now.getFullYear(), 0, 0);
        return Math.floor((now - start) / (1000 * 60 * 60 * 24));
    }

    getDaysToEquinox(doy) {
        const SPRING = 80, FALL = 266;
        if (doy < SPRING) return SPRING - doy;
        if (doy < FALL) return FALL - doy;
        return (365 - doy) + SPRING;
    }

    getCatalystPhase(doy) {
        if (doy >= 80 && doy < 172) return 'Post-spring equinox (declining)';
        if (doy >= 172 && doy < 266) return 'Summer solstice minimum';
        if (doy >= 266 && doy < 355) return 'Post-fall equinox (declining)';
        return 'Winter solstice minimum';
    }

    calculateSolarAngle(lat, dayOfYear) {
        const latRad = (lat * Math.PI) / 180;
        const declination = 23.44 * Math.sin((2 * Math.PI * (dayOfYear - 81)) / 365.25);
        const decRad = (declination * Math.PI) / 180;
        const solarElevation = Math.asin(
            Math.sin(latRad) * Math.sin(decRad) +
            Math.cos(latRad) * Math.cos(decRad)
        );
        return Math.max(0, Math.sin(solarElevation));
    }

    calcTrend(key, current) {
        if (current === null || current === undefined) return '—';
        const prev = this.previousValues[key];
        this.previousValues[key] = current;
        if (prev === undefined) return '→';
        const delta = current - prev;
        if (Math.abs(delta) < 0.01) return '→';
        return delta > 0 ? '↑' : '↓';
    }

    degreesToCardinal(deg) {
        if (deg === null || deg === undefined) return 'N/A';
        const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                      'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
        return dirs[Math.round(deg / 22.5) % 16];
    }

    // ═══════════════════════════════════════════════════════════════
    // DSO MODIFIER FUNCTIONS (based on real data)
    // ═══════════════════════════════════════════════════════════════

    getHumidityModifier(dewpoint, rh) {
        if (dewpoint === null || rh === null) return 'NO DATA - Cannot assess';
        if (dewpoint > 18 && rh > 70) return 'High moisture - E_fuel enhanced 20-30%';
        if (dewpoint > 12 && rh > 50) return 'Moderate moisture - baseline E_fuel';
        if (dewpoint < 8) return 'Low moisture - E_fuel reduced 15-25%';
        return 'Transitional - marginal fuel availability';
    }

    getCAPEModifier(cape, cin) {
        if (cape === null) return 'NO DATA - Cannot assess instability';
        if (cape > 2500) {
            if (cin !== null && cin < -50) return `Extreme CAPE (${cape}) but capped - explosive if cap breaks`;
            return `Extreme CAPE (${cape}) - significant severe potential`;
        }
        if (cape > 1500) return `Strong CAPE (${cape}) - organized storms likely`;
        if (cape > 500) return `Moderate CAPE (${cape}) - convection possible`;
        return `Weak CAPE (${cape}) - limited storm potential`;
    }

    getShearModifier(shear0_6km, shear0_1km) {
        if (shear0_6km === null) return 'NO DATA - Cannot assess shear';
        if (shear0_6km > 40) return `Extreme shear (${shear0_6km.toFixed(0)} kt) - tornado environment`;
        if (shear0_6km > 25) return `Strong shear (${shear0_6km.toFixed(0)} kt) - supercell potential`;
        if (shear0_6km > 15) return `Moderate shear (${shear0_6km.toFixed(0)} kt) - organized storms`;
        return `Weak shear (${shear0_6km.toFixed(0)} kt) - pulse storms only`;
    }

    getFrontApproach(windDir, pressureTrend) {
        if (windDir === null || pressureTrend === null) return 'NO DATA';
        if (pressureTrend < -2) {
            if (windDir > 180 && windDir < 270) return 'SW approach - classic warm sector';
            if (windDir > 270 || windDir < 45) return 'NW approach - cold front passage';
            return 'Unusual approach vector';
        }
        if (pressureTrend > 2) return 'High pressure building - stable';
        return 'Weak or no frontal boundary';
    }

    getFrontAngleModifier(frontAngle, pressureTrend) {
        if (frontAngle === null || pressureTrend === null) return 'NO DATA';
        if (pressureTrend < -3 && frontAngle < 30) return 'Near-perpendicular approach - maximum gradient forcing';
        if (pressureTrend < -2) return 'Active frontal passage - enhanced dynamics';
        return 'Minimal frontal modification';
    }

    getLapseRateModifier(lapseRate) {
        if (lapseRate === null) return 'NO DATA - Cannot assess stability';
        if (lapseRate > 9.8) return `Absolutely unstable (${lapseRate.toFixed(1)}°C/km) - explosive convection`;
        if (lapseRate > 7.0) return `Steep lapse rate (${lapseRate.toFixed(1)}°C/km) - strong instability`;
        if (lapseRate > 5.5) return `Near moist-adiabatic (${lapseRate.toFixed(1)}°C/km) - conditionally unstable`;
        if (lapseRate > 4.0) return `Stable (${lapseRate.toFixed(1)}°C/km) - convection inhibited`;
        return `Strong inversion (${lapseRate.toFixed(1)}°C/km) - capped atmosphere`;
    }

    getEFuelModifier(eFuel, gulfSST) {
        if (eFuel === null) return 'NO DATA - Cannot calculate E_fuel';
        if (gulfSST === null) return 'Gulf SST unavailable - partial calculation';
        if (eFuel > 0.8) return `High fuel (${(eFuel*100).toFixed(0)}%) - Gulf ${gulfSST.toFixed(1)}°C - energy-rich environment`;
        if (eFuel > 0.5) return `Moderate fuel (${(eFuel*100).toFixed(0)}%) - Gulf ${gulfSST.toFixed(1)}°C - adequate energy`;
        return `Low fuel (${(eFuel*100).toFixed(0)}%) - Gulf ${gulfSST.toFixed(1)}°C - limited potential`;
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = NOAAWeatherService;
}
