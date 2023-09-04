import * as fs from "fs";
import { fromFile } from "geotiff";


class GeoJSONRewind {

    rewindRing(ring, dir) {
        var area = 0, err = 0;
        for (var i = 0, len = ring.length, j = len - 1; i < len; j = i++) {
            var k = (ring[i][0] - ring[j][0]) * (ring[j][1] + ring[i][1]);
            var m = area + k;
            err += Math.abs(area) >= Math.abs(k) ? area - m + k : k - m + area;
            area = m;
        }
        if (area + err >= 0 !== !!dir) ring.reverse();
    }
  
    rewindRings(rings, outer) {
        if (rings.length === 0) return;
  
        this.rewindRing(rings[0], outer);
        for (var i = 1; i < rings.length; i++) {
            this.rewindRing(rings[i], !outer);
        }
    }
  
    rewind(gj, outer) {
        var type = gj && gj.type, i;
  
        if (type === 'FeatureCollection') {
            for (i = 0; i < gj.features.length; i++) this.rewind(gj.features[i], outer);
  
        } else if (type === 'GeometryCollection') {
            for (i = 0; i < gj.geometries.length; i++) this.rewind(gj.geometries[i], outer);
  
        } else if (type === 'Feature') {
            this.rewind(gj.geometry, outer);
  
        } else if (type === 'Polygon') {
            this.rewindRings(gj.coordinates, outer);
  
        } else if (type === 'MultiPolygon') {
            for (i = 0; i < gj.coordinates.length; i++) this.rewindRings(gj.coordinates[i], outer);
        }
  
        return gj;
    }
  }



const d3 = await Promise.all([
    import("d3-format"),
    import("d3-geo"),
    import("d3-geo-projection"),
    import("d3"),
  ]).then(d3 => Object.assign({}, ...d3));


function convertContoursToGeoJSON(contours) {
    const geojson = {
        type: "FeatureCollection",
        features: []
    }

    for (const contour of contours) {
        if (contour.type === "Sphere") {
            continue;
        }

        const feature = {
            type: "Feature",
            geometry: {
                type: contour.type,
                coordinates: contour.coordinates
            },
            properties: {
                value: contour.value
            }
        };
        geojson.features.push(feature);
    }

    return geojson;
}

function splitPolygonsThatCrossAntimeridian(geojson) {
    const newFeatures = [];
    for (const feature of geojson.features) {
        if (feature.geometry.type === "Polygon") {
            const newFeature = {
                type: "Feature",
                geometry: {
                    type: "MultiPolygon",
                    coordinates: []
                },
                properties: feature.properties
            };
            const polygon = feature.geometry.coordinates;
            const newPolygon = [];
            for (const ring of polygon) {
                const newRing = [];
                for (const point of ring) {
                    if (point[0] > 180) {
                        newRing.push([point[0] - 360, point[1]]);
                    } else {
                        newRing.push(point);
                    }
                }
                newPolygon.push(newRing);
            }
            newFeature.geometry.coordinates.push(newPolygon);
            newFeatures.push(newFeature);
        } else if (feature.geometry.type === "MultiPolygon") {
            const newFeature = {
                type: "Feature",
                geometry: {
                    type: "MultiPolygon",
                    coordinates: []
                },
                properties: feature.properties
            };
            const polygons = feature.geometry.coordinates;
            for (const polygon of polygons) {
                const newPolygon = [];
                for (const ring of polygon) {
                    const newRing = [];
                    for (const point of ring) {
                        if (point[0] > 180) {
                            newRing.push([point[0] - 360, point[1]]);
                        } else {
                            newRing.push(point);
                        }
                    }
                    newPolygon.push(newRing);
                }
                newFeature.geometry.coordinates.push(newPolygon);
            }
            newFeatures.push(newFeature);
        } else {
            newFeatures.push(feature);
        }
    }
    geojson.features = newFeatures;
    return geojson;
}

async function main() {
    const tiff_file_name = "sfctmp.tiff";
    const tiff = await fromFile(tiff_file_name);
    const image = await tiff.getImage();
    const m = image.getHeight();
    const n = image.getWidth();
    const values = rotate((await image.readRasters())[0], m, n);
    const color = d3.scaleSequential(d3.interpolateMagma).domain(d3.extent(values));
    const projection = d3.geoEquirectangular().precision(0.1);
    // const projection = d3.geoOrthographic();
    const path = d3.geoPath(projection);
    const contours = d3.contours().size([n, m]).smooth(false).thresholds(30);
    const contours_ = contours(values);
    console.log("The number of contours is: ", contours_.length);
    const geojson = contours_.map(d => invert(d, m, n));
    console.log("The number of geojson features is: ", geojson.length);
    projection.fitSize([n, m], geojson[0]);
    const paths = Array.from(geojson, d => `<path d=${path(d)} fill=${color(d.value)} />`).join("");
    const chart = `
        <svg style="width: 2000px; height: auto; display: block; background:grey;" viewBox="0 0 ${n} ${m}">
            <g stroke="#000" stroke-width="0" stroke-linejoin="round" stroke-linecap="round">
                ${paths}
            </g>
        </svg>
    `
    fs.writeFileSync("output.html", chart, "utf8", () => console.log("done"));
    const rewinder = new GeoJSONRewind();
    const featureCollection = rewinder.rewind(splitPolygonsThatCrossAntimeridian(convertContoursToGeoJSON(geojson)));
    console.log("The number of features in the feature collection is: ", featureCollection.features.length);
    fs.writeFileSync("output.json", JSON.stringify(featureCollection), "utf8", () => console.log("done"));
    console.log(`geographic bounds: ${d3.geoBounds(featureCollection)}`)
}



function rotate(values, m, n) {
    // Rotate a GeoTiff's longitude from [0, 360] to [-180, 180]
    var l = n >> 1;
    for (var j = 0, k = 0; j < m; ++j, k += n) {
        values.subarray(k, k + l).reverse();
        values.subarray(k + l, k + n).reverse();
        values.subarray(k, k + n).reverse();
    }
    return values;
}


function invert(d, m, n) {
    const shared = {};
  
    let p = {
      type: "Polygon",
      coordinates: d3.merge(d.coordinates.map(polygon => {
        return polygon.map(ring => {
          return ring.map(point => {
            return [point[0] / n * 360 - 180, 90 - point[1] / m * 180];
          }).reverse();
        });
      }))
    };
  
    // Record the y-intersections with the antimeridian.
    p.coordinates.forEach(ring => {
      ring.forEach(p => {
        if (p[0] === -180) shared[p[1]] |= 1;
        else if (p[0] === 180) shared[p[1]] |= 2;
      });
    });
  
    // Offset any unshared antimeridian points to prevent their stitching.
    p.coordinates.forEach(ring => {
      ring.forEach(p => {
        if ((p[0] === -180 || p[0] === 180) && shared[p[1]] !== 3) {
          p[0] = p[0] === -180 ? -179.9995 : 179.9995;
        }
      });
    });
  
    p = d3.geoStitch(p);
  
    // If the MultiPolygon is empty, treat it as the Sphere.
    return p.coordinates.length
        ? {type: "Polygon", coordinates: p.coordinates, value: d.value}
        : {type: "Sphere", value: d.value};
  }


await main();