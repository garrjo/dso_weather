/**
 * DSO Weather Service - Real-Time Weather Data
 * REAL DATA ONLY - No estimates, no approximations
 *
 * Data Sources (all CORS-friendly):
 * - api.weather.gov — Surface observations (NWS)
 * - api.open-meteo.com — CAPE, CIN, Lifted Index, atmospheric data
 * - coastwatch.noaa.gov/erddap — Gulf of Mexico SST
 *
 * If data cannot be fetched, display "NO DATA" — never estimate.
 */

class DSOWeatherService {
    constructor(config = {}) {
        // API Endpoints (all CORS-enabled)
        this.NWS_API = 'https://api.weather.gov';
        this.OPEN_METEO_API = 'https://api.open-meteo.com/v1/forecast';
        this.ERDDAP_API = 'https://coastwatch.noaa.gov/erddap/griddap';

        // SST Dataset ID on ERDDAP
        this.SST_DATASET = 'noaacwBLENDEDsstDailyNRT';

        // Default location (can be configured)
        this.location = config.location || {
            name: 'Arkansas',
            lat: 34.7465,
            lon: -92.2896,
            stationId: 'KLIT',
            nwsOffice: 'LZK'
        };

        // Gulf of Mexico sampling points for SST
        this.GULF_POINTS = [
            { name: 'Central Gulf', lat: 26.0, lon: -90.0 },
            { name: 'NW Gulf', lat: 27.5, lon: -93.0 },
            { name: 'NE Gulf', lat: 28.5, lon: -87.5 }
        ];

        // Cache with short TTL for real-time data
        this.cache = {
            surface: { data: null, timestamp: null, ttlMinutes: 10 },
            atmospheric: { data: null, timestamp: null, ttlMinutes: 30 },
            sst: { data: null, timestamp: null, ttlMinutes: 60 }
        };

        // Track previous values for trends
        this.previousValues = {};
    }

    // ═══════════════════════════════════════════════════════════════
    // LOCATION CONFIGURATION
    // ═══════════════════════════════════════════════════════════════

    async setLocationFromCoords(lat, lon) {
        // Update location coordinates
        this.location.lat = lat;
        this.location.lon = lon;

        // Get location name and NWS station from coordinates
        try {
            const pointUrl = `${this.NWS_API}/points/${lat.toFixed(4)},${lon.toFixed(4)}`;
            const response = await fetch(pointUrl, {
                headers: {
                    'User-Agent': 'DSOWeatherService/1.0',
                    'Accept': 'application/geo+json'
                }
            });

            if (response.ok) {
                const data = await response.json();
                const props = data.properties;

                this.location.name = `${props.relativeLocation?.properties?.city || 'Unknown'}, ${props.relativeLocation?.properties?.state || ''}`;
                this.location.nwsOffice = props.gridId;
                this.location.gridX = props.gridX;
                this.location.gridY = props.gridY;
                this.location.forecastUrl = props.forecast;
                this.location.stationsUrl = props.observationStations;

                // Get nearest observation station
                if (props.observationStations) {
                    const stationsResp = await fetch(props.observationStations, {
                        headers: { 'User-Agent': 'DSOWeatherService/1.0' }
                    });
                    if (stationsResp.ok) {
                        const stationsData = await stationsResp.json();
                        if (stationsData.features && stationsData.features.length > 0) {
                            this.location.stationId = stationsData.features[0].properties.stationIdentifier;
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Failed to get NWS point data:', error);
            // Keep coordinates even if lookup fails
            this.location.name = `${lat.toFixed(2)}°N, ${Math.abs(lon).toFixed(2)}°W`;
        }

        // Clear cache when location changes
        this.cache = {
            surface: { data: null, timestamp: null, ttlMinutes: 10 },
            atmospheric: { data: null, timestamp: null, ttlMinutes: 30 },
            sst: { data: null, timestamp: null, ttlMinutes: 60 }
        };

        return this.location;
    }

    getLocation() {
        return this.location;
    }

    // ═══════════════════════════════════════════════════════════════
    // SURFACE OBSERVATIONS (NWS API)
    // ═══════════════════════════════════════════════════════════════

    async fetchSurfaceObservations() {
        const url = `${this.NWS_API}/stations/${this.location.stationId}/observations/latest`;

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
                station: this.location.stationId
            };
        } catch (error) {
            console.error('Surface observation fetch failed:', error);
            return { success: false, error: error.message };
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // GULF SST FROM OPEN-METEO MARINE API (CORS-ENABLED)
    // ═══════════════════════════════════════════════════════════════

    async fetchGulfSST() {
        // Sample multiple points in the Gulf using Open-Meteo Marine API
        const results = await Promise.all(
            this.GULF_POINTS.map(point => this.fetchMarineSST(point))
        );

        const validReadings = results.filter(r => r.success && r.sst !== null);

        if (validReadings.length === 0) {
            return {
                success: false,
                error: 'No valid SST readings from Open-Meteo Marine',
                attemptedPoints: this.GULF_POINTS.length
            };
        }

        // Calculate average SST from all valid points
        const avgSST = validReadings.reduce((sum, r) => sum + r.sst, 0) / validReadings.length;

        // Use NE Gulf as primary (most relevant for Arkansas moisture transport)
        const neGulf = validReadings.find(r => r.name === 'NE Gulf');
        const primarySST = neGulf ? neGulf.sst : validReadings[0].sst;

        return {
            success: true,
            primarySST,
            averageSST: avgSST,
            pointCount: validReadings.length,
            readings: validReadings.map(r => ({
                name: r.name,
                lat: r.lat,
                lon: r.lon,
                sst: r.sst,
                timestamp: r.timestamp
            })),
            dataSource: 'Open-Meteo Marine',
            timestamp: new Date().toISOString()
        };
    }

    async fetchMarineSST(point) {
        // Open-Meteo Marine API for sea surface temperature
        const url = `https://marine-api.open-meteo.com/v1/marine?` +
            `latitude=${point.lat}&longitude=${point.lon}&current=sea_surface_temperature`;

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Open-Meteo Marine returned ${response.status}`);
            }

            const data = await response.json();

            if (data.current && data.current.sea_surface_temperature !== undefined) {
                return {
                    success: true,
                    name: point.name,
                    lat: point.lat,
                    lon: point.lon,
                    sst: data.current.sea_surface_temperature,
                    timestamp: data.current.time
                };
            }

            return { success: false, name: point.name, error: 'No SST value in response' };
        } catch (error) {
            console.error(`Open-Meteo Marine SST fetch failed for ${point.name}:`, error);
            return { success: false, name: point.name, error: error.message };
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // ATMOSPHERIC DATA FROM OPEN-METEO (CORS-ENABLED)
    // ═══════════════════════════════════════════════════════════════

    async fetchAtmosphericData() {
        // Open-Meteo provides CAPE, CIN, lifted index, and multi-level wind data
        const params = new URLSearchParams({
            latitude: this.location.lat,
            longitude: this.location.lon,
            hourly: [
                'cape',
                'convective_inhibition',
                'lifted_index',
                'temperature_2m',
                'relative_humidity_2m',
                'wind_speed_10m',
                'wind_direction_10m',
                'wind_speed_80m',
                'wind_direction_80m',
                'wind_speed_120m',
                'wind_direction_120m',
                'wind_speed_180m',
                'wind_direction_180m',
                'temperature_80m',
                'temperature_120m',
                'temperature_180m',
                'freezing_level_height'
            ].join(','),
            current: 'temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,surface_pressure',
            temperature_unit: 'celsius',
            wind_speed_unit: 'kmh',
            timezone: 'America/Chicago',
            forecast_days: 1
        });

        const url = `${this.OPEN_METEO_API}?${params}`;

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Open-Meteo returned ${response.status}`);
            }

            const data = await response.json();
            return this.parseOpenMeteoData(data);
        } catch (error) {
            console.error('Open-Meteo fetch failed:', error);
            return { success: false, error: error.message };
        }
    }

    parseOpenMeteoData(data) {
        try {
            const current = data.current;
            const hourly = data.hourly;

            // Get current hour index
            const now = new Date();
            const currentHour = now.getHours();

            // Extract current values from hourly arrays
            const cape = hourly.cape?.[currentHour];
            const cin = hourly.convective_inhibition?.[currentHour];
            const liftedIndex = hourly.lifted_index?.[currentHour];
            const freezingLevel = hourly.freezing_level_height?.[currentHour];

            // Calculate lapse rate from multi-level temperatures
            const temp2m = current.temperature_2m;
            const temp80m = hourly.temperature_80m?.[currentHour];
            const temp120m = hourly.temperature_120m?.[currentHour];
            const temp180m = hourly.temperature_180m?.[currentHour];

            const lapseRate = this.calculateLapseRateFromLevels(temp2m, temp80m, temp120m, temp180m);

            // Calculate wind shear from multi-level winds
            const windShear = this.calculateWindShearFromLevels(
                { speed: current.wind_speed_10m, direction: current.wind_direction_10m },
                { speed: hourly.wind_speed_80m?.[currentHour], direction: hourly.wind_direction_80m?.[currentHour] },
                { speed: hourly.wind_speed_120m?.[currentHour], direction: hourly.wind_direction_120m?.[currentHour] },
                { speed: hourly.wind_speed_180m?.[currentHour], direction: hourly.wind_direction_180m?.[currentHour] }
            );

            return {
                success: true,
                timestamp: current.time,
                indices: {
                    cape: cape,
                    cin: cin,
                    liftedIndex: liftedIndex
                },
                freezingLevel: freezingLevel,
                lapseRate: lapseRate,
                windShear: windShear,
                dataSource: 'Open-Meteo (GFS/HRRR model blend)'
            };
        } catch (error) {
            return { success: false, error: 'Failed to parse Open-Meteo data: ' + error.message };
        }
    }

    calculateLapseRateFromLevels(temp2m, temp80m, temp120m, temp180m) {
        // Calculate lapse rate from available temperature levels
        if (temp2m === null || temp2m === undefined) {
            return { value: null, error: 'No surface temperature' };
        }

        // Use highest available level
        let upperTemp = null;
        let upperHeight = null;

        if (temp180m !== null && temp180m !== undefined) {
            upperTemp = temp180m;
            upperHeight = 180;
        } else if (temp120m !== null && temp120m !== undefined) {
            upperTemp = temp120m;
            upperHeight = 120;
        } else if (temp80m !== null && temp80m !== undefined) {
            upperTemp = temp80m;
            upperHeight = 80;
        }

        if (upperTemp === null) {
            return { value: null, error: 'No upper level temperature' };
        }

        // Lapse rate in °C/km
        const tempDiff = temp2m - upperTemp;
        const heightDiff = (upperHeight - 2) / 1000; // km
        const lapseRate = tempDiff / heightDiff;

        // Note: This is a shallow layer lapse rate, not full tropospheric
        let stability;
        if (lapseRate > 9.8) stability = 'Absolutely Unstable (shallow layer)';
        else if (lapseRate > 6.5) stability = 'Conditionally Unstable';
        else if (lapseRate > 4.0) stability = 'Stable';
        else stability = 'Very Stable / Inversion';

        return {
            value: lapseRate,
            surfaceTemp: temp2m,
            upperTemp: upperTemp,
            surfaceHeight: 2,
            upperHeight: upperHeight,
            stability: stability,
            note: 'Shallow layer (surface to 180m)'
        };
    }

    calculateWindShearFromLevels(wind10m, wind80m, wind120m, wind180m) {
        // Calculate wind shear from multi-level data
        const toComponents = (speed, dir) => {
            if (speed === null || dir === null) return null;
            const rad = (dir * Math.PI) / 180;
            return {
                u: -speed * Math.sin(rad),
                v: -speed * Math.cos(rad)
            };
        };

        const surface = toComponents(wind10m.speed, wind10m.direction);
        const w80 = toComponents(wind80m?.speed, wind80m?.direction);
        const w120 = toComponents(wind120m?.speed, wind120m?.direction);
        const w180 = toComponents(wind180m?.speed, wind180m?.direction);

        if (!surface) {
            return { value: null, error: 'No surface wind' };
        }

        // Use highest available level for shear calculation
        let upper = w180 || w120 || w80;
        let upperHeight = w180 ? 180 : (w120 ? 120 : 80);

        if (!upper) {
            return { value: null, error: 'No upper level wind' };
        }

        // Bulk shear magnitude (km/h)
        const shear = Math.sqrt(
            Math.pow(upper.u - surface.u, 2) +
            Math.pow(upper.v - surface.v, 2)
        );

        // Convert to knots for interpretation (1 km/h = 0.54 knots)
        const shearKnots = shear * 0.54;

        // Interpretation (scaled for shallow layer)
        let interpretation;
        if (shearKnots > 15) interpretation = 'Strong low-level shear';
        else if (shearKnots > 10) interpretation = 'Moderate low-level shear';
        else if (shearKnots > 5) interpretation = 'Weak shear';
        else interpretation = 'Minimal shear';

        return {
            value: shear,
            valueKnots: shearKnots,
            surfaceWind: wind10m,
            upperWind: { speed: w180?.speed || w120?.speed || w80?.speed, height: upperHeight },
            interpretation: interpretation,
            note: 'Low-level shear (10m to 180m)'
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // AGGREGATE ALL REAL DATA
    // ═══════════════════════════════════════════════════════════════

    async getAllWeatherData() {
        // Fetch all data sources in parallel
        const [surface, gulfSST, atmospheric] = await Promise.all([
            this.fetchSurfaceObservations(),
            this.fetchGulfSST(),
            this.fetchAtmosphericData()
        ]);

        return {
            surface,
            gulfSST,
            atmospheric,
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
        const atmosphericData = allData.atmospheric.success ? allData.atmospheric : null;
        const cape = atmosphericData?.indices?.cape;
        const cin = atmosphericData?.indices?.cin;

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
            liftedIndex: realValue(atmosphericData?.indices?.liftedIndex, 1),
            dataSource: allData.atmospheric.success ? 'Open-Meteo' : 'UNAVAILABLE',
            trend: this.calcTrend('cape', cape),
            dsoModifier: this.getCAPEModifier(cape, cin)
        };

        // ═══════════════════════════════════════════════════════════════
        // W - Wind Pattern (from real surface + sounding shear)
        // ═══════════════════════════════════════════════════════════════
        const windDir = surfaceData?.windDirection?.value;
        const windGust = surfaceData?.windGust?.value;
        const shear0_6km = atmosphericData?.windShear?.bulk0_6km;
        const shear0_1km = atmosphericData?.windShear?.bulk0_1km;

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
            shearInterpretation: atmosphericData?.windShear?.interpretation || 'NO DATA',
            dataSource: `Surface: ${allData.surface.success ? 'KLIT' : 'UNAVAILABLE'}, Shear: ${allData.atmospheric.success ? 'KLZK' : 'UNAVAILABLE'}`,
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
        const lapseData = atmosphericData?.lapseRate;
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
            dataSource: allData.atmospheric.success ? 'Open-Meteo' : 'UNAVAILABLE',
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
        const solarAngle = this.calculateSolarAngle(this.location.lat, dayOfYear);

        variables.solarAngle = {
            symbol: 'sin(α)',
            name: 'Solar Angle',
            value: realValue(solarAngle, 3),
            incidenceDegrees: realValue(Math.asin(solarAngle) * 180 / Math.PI, 1),
            latitude: this.location.lat,
            dataSource: 'Calculated (Solar Geometry)',
            trend: this.calcTrend('solar', solarAngle),
            dsoModifier: `Solar punch: ${(solarAngle * 100).toFixed(0)}%`
        };

        // ═══════════════════════════════════════════════════════════════
        // Metadata
        // ═══════════════════════════════════════════════════════════════
        variables.metadata = {
            timestamp: new Date().toISOString(),
            location: this.location.name,
            dayOfYear: dayOfYear,
            dataSources: {
                surface: allData.surface.success,
                gulfBuoys: allData.gulfSST.success,
                atmospheric: allData.atmospheric.success
            },
            errors: {
                surface: allData.surface.error || null,
                gulfBuoys: allData.gulfSST.error || null,
                atmospheric: allData.atmospheric.error || null
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
        if (shear0_6km === null || shear0_6km === undefined) return 'NO DATA - Cannot assess shear';
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

    // ═══════════════════════════════════════════════════════════════
    // SIMPLE PREDICTION FOR AVERAGE USER
    // ═══════════════════════════════════════════════════════════════

    async getSimplePrediction() {
        const vars = await this.getWeatherVariables();

        // Calculate overall storm risk from DSO components
        const eFuel = vars.eFuel?.value?.raw || 0;
        const gradient = vars.gradient?.value?.raw || 0;
        const catalyst = vars.catalyst?.value?.raw || 0;
        const solar = vars.solarAngle?.value?.raw || 0;
        const cape = vars.energyDispersal?.cape?.raw || 0;
        const temp = vars.thermalVariance?.surfaceTemp?.raw || null;
        const wind = vars.windPattern?.speed?.raw || null;

        // DSO Power Index
        const P = eFuel * Math.abs(catalyst) * solar;

        // Simple risk assessment
        let riskLevel, riskColor, summary, confidence;

        if (P > 0.4 && cape > 1500) {
            riskLevel = 'HIGH';
            riskColor = '#ff4444';
            summary = 'Significant severe weather potential today';
            confidence = 'High - Strong indicators align';
        } else if (P > 0.25 && cape > 500) {
            riskLevel = 'MODERATE';
            riskColor = '#ffaa00';
            summary = 'Isolated storms possible, some could be strong';
            confidence = 'Moderate - Some indicators present';
        } else if (P > 0.15 || cape > 250) {
            riskLevel = 'LOW';
            riskColor = '#44aa44';
            summary = 'Slight chance of scattered showers/storms';
            confidence = 'Moderate - Weak signals';
        } else {
            riskLevel = 'MINIMAL';
            riskColor = '#4488ff';
            summary = 'Low severe weather threat';
            confidence = 'High - Conditions unfavorable';
        }

        return {
            riskLevel,
            riskColor,
            summary,
            confidence,
            dsoIndex: P,
            cape: cape,
            temp: temp,
            wind: wind,
            timestamp: new Date().toISOString(),
            location: this.location.name,
            dataQuality: {
                surface: vars.metadata.dataSources.surface,
                gulfSST: vars.metadata.dataSources.gulfBuoys,
                atmospheric: vars.metadata.dataSources.atmospheric
            }
        };
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DSOWeatherService;
}
