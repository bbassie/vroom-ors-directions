import { Coordinate, ORSDirectionsOptions, ORSDirectionsResponse, MatrixEntry } from './types.js';

export class ORSClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(apiKey: string, baseUrl: string = 'https://api.openrouteservice.org') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async getDirections(
    coordinates: Coordinate[],
    options: ORSDirectionsOptions = {}
  ): Promise<ORSDirectionsResponse> {
    const {
      profile = 'driving-car',
      format = 'json',
      units = 'km',
      geometry = false,
      instructions = false,
      elevation = false,
      extra_info = [],
      options: routeOptions = {}
    } = options;

    const coordinatesArray = coordinates.map(coord => [coord.lng, coord.lat]);

    const body = {
      coordinates: coordinatesArray,
      format,
      units,
      geometry,
      instructions,
      elevation,
      extra_info,
      options: routeOptions
    };

    const response = await fetch(`${this.baseUrl}/v2/directions/${profile}`, {
      method: 'POST',
      headers: {
        'Authorization': this.apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ORS API error: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  async createMatrix(
    locations: Coordinate[],
    options: ORSDirectionsOptions = {}
  ): Promise<MatrixEntry[]> {
    const promises: Promise<MatrixEntry>[] = [];

    // Create all direction requests as promises
    for (let i = 0; i < locations.length; i++) {
      for (let j = 0; j < locations.length; j++) {
        if (i === j) {
          // Same location - add zero distance/duration entry
          promises.push(Promise.resolve({
            from: i,
            to: j,
            distance: 0,
            duration: 0,
            geometry: undefined
          }));
        } else {
          // Different locations - create ORS request
          promises.push(this.getDirectionEntry(locations[i], locations[j], i, j, options));
        }
      }
    }

    // Execute all requests in parallel with controlled concurrency
    const matrix = await this.executeWithConcurrency(promises, 10); // Limit to 10 concurrent requests

    return matrix;
  }

  private async getMatrixBatch(
    fromLocations: Coordinate[],
    toLocations: Coordinate[],
    fromOffset: number,
    toOffset: number,
    options: ORSDirectionsOptions
  ): Promise<MatrixEntry[]> {
    const entries: MatrixEntry[] = [];

    for (let i = 0; i < fromLocations.length; i++) {
      for (let j = 0; j < toLocations.length; j++) {
        if (fromOffset + i === toOffset + j) {
          entries.push({
            from: fromOffset + i,
            to: toOffset + j,
            distance: 0,
            duration: 0
          });
          continue;
        }

        try {
          const directionsOptions = {
            ...options,
            geometry: true, // Enable geometry collection
            geometry_format: 'polyline' // Request encoded polyline format
          };

          const directions = await this.getDirectionsWithRetry(
            [fromLocations[i], toLocations[j]],
            directionsOptions
          );

          if (directions.routes && directions.routes.length > 0) {
            const route = directions.routes[0];
            console.log(`Route structure for ${fromOffset + i} -> ${toOffset + j}:`, {
              hasGeometry: !!route.geometry,
              geometryType: typeof route.geometry,
              geometryKeys: route.geometry ? Object.keys(route.geometry) : null,
              geometryPreview: route.geometry ? JSON.stringify(route.geometry).substring(0, 100) + '...' : 'No geometry'
            });

            // Extract polyline string from geometry
            let polyline: string | undefined = undefined;
            if (route.geometry) {
              if (typeof route.geometry === 'string') {
                polyline = route.geometry;
              } else if (route.geometry.coordinates) {
                // GeoJSON format - convert to polyline or handle differently
                polyline = JSON.stringify(route.geometry.coordinates);
              } else if (route.geometry.polyline) {
                polyline = route.geometry.polyline;
              }
            }

            entries.push({
              from: fromOffset + i,
              to: toOffset + j,
              distance: route.summary.distance,
              duration: route.summary.duration,
              geometry: polyline
            });
          } else {
            entries.push({
              from: fromOffset + i,
              to: toOffset + j,
              distance: 999999, // 999,999 km - unreachably far
              duration: 999999,   // 999,999 seconds - about 11.5 days
              geometry: undefined
            });
          }

          await this.delay(1000); // Increase delay to 1 second to respect rate limits
        } catch (error) {
          console.warn(`Failed to get directions from ${fromOffset + i} to ${toOffset + j}:`, error);
          // Use large finite values instead of Infinity
          entries.push({
            from: fromOffset + i,
            to: toOffset + j,
            distance: 999999, // 999,999 km - unreachably far
            duration: 999999,   // 999,999 seconds - about 11.5 days
            geometry: undefined
          });
        }
      }
    }

    return entries;
  }

  private async getDirectionsWithRetry(
    coordinates: Coordinate[],
    options: ORSDirectionsOptions,
    maxRetries: number = 3
  ): Promise<ORSDirectionsResponse> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.getDirections(coordinates, options);
      } catch (error: any) {
        if (error.message?.includes('429') || error.message?.includes('Rate Limit')) {
          if (attempt < maxRetries) {
            const delay = Math.pow(2, attempt) * 2000; // Exponential backoff: 2s, 4s, 8s
            console.warn(`Rate limit hit, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
            await this.delay(delay);
            continue;
          }
        }
        throw error;
      }
    }
    throw new Error('Max retries exceeded');
  }

  private async getDirectionEntry(
    from: Coordinate,
    to: Coordinate,
    fromIndex: number,
    toIndex: number,
    options: ORSDirectionsOptions
  ): Promise<MatrixEntry> {
    try {
      const directionsOptions = {
        ...options,
        geometry: true, // Enable geometry collection
        geometry_format: 'polyline' // Request encoded polyline format
      };

      const directions = await this.getDirectionsWithRetry([from, to], directionsOptions);

      if (directions.routes && directions.routes.length > 0) {
        const route = directions.routes[0];
        console.log(`Route structure for ${fromIndex} -> ${toIndex}:`, {
          hasGeometry: !!route.geometry,
          geometryType: typeof route.geometry,
          geometryKeys: route.geometry ? Object.keys(route.geometry) : null,
          geometryPreview: route.geometry ? JSON.stringify(route.geometry).substring(0, 100) + '...' : 'No geometry'
        });

        // Extract polyline string from geometry
        let polyline: string | undefined = undefined;
        if (route.geometry) {
          if (typeof route.geometry === 'string') {
            polyline = route.geometry;
          } else if (route.geometry.coordinates) {
            // GeoJSON format - convert to polyline or handle differently
            polyline = JSON.stringify(route.geometry.coordinates);
          } else if (route.geometry.polyline) {
            polyline = route.geometry.polyline;
          }
        }

        return {
          from: fromIndex,
          to: toIndex,
          distance: route.summary.distance,
          duration: route.summary.duration,
          geometry: polyline
        };
      } else {
        return {
          from: fromIndex,
          to: toIndex,
          distance: 999999, // 999,999 km - unreachably far
          duration: 999999,   // 999,999 seconds - about 11.5 days
          geometry: undefined
        };
      }
    } catch (error) {
      console.warn(`Failed to get directions from ${fromIndex} to ${toIndex}:`, error);
      return {
        from: fromIndex,
        to: toIndex,
        distance: 999999, // 999,999 km - unreachably far
        duration: 999999,   // 999,999 seconds - about 11.5 days
        geometry: undefined
      };
    }
  }

  private async executeWithConcurrency<T>(
    promises: Promise<T>[],
    concurrency: number
  ): Promise<T[]> {
    const results: T[] = [];

    for (let i = 0; i < promises.length; i += concurrency) {
      const batch = promises.slice(i, i + concurrency);
      const batchResults = await Promise.all(batch);
      results.push(...batchResults);

      // Add a small delay between batches to be nice to the API
      if (i + concurrency < promises.length) {
        await this.delay(100);
      }
    }

    return results;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}