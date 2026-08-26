# Vendored runtime artifacts

Exact npm registry tarballs, downloaded 2026-08-25 and verified byte-for-byte against the sha512 integrity values in upstream package-lock.json at pinned commit 880a672b5e16ad3e41d318801d3a5203f9201923. No package manager install was run; no lifecycle scripts executed. Only the runtime files listed per package were staged into libs/.

| Package | Version | Registry tarball | sha512 (verified = lockfile integrity) |
|---|---|---|---|
| cesium | 1.138.0 | https://registry.npmjs.org/cesium/-/cesium-1.138.0.tgz | sha512-YX7Ttd4LzAxunuzcKPyOCQa+BPc2RmenqnkM5uZkk/GVwor724bd+F3kdVP4IyMbTgxFkchXuX2Aa8L1Y0/ZxA== |
| @cesium/engine | 22.3.0 | https://registry.npmjs.org/@cesium/engine/-/engine-22.3.0.tgz | sha512-oDl+nWX/qfHYQ0lEdGxLqZoKEtTMghvJDzZKTycYfiIuDYDh8Kh0Oy45wr3mSJse3PuTj1e6hDmbw8vbycCOxw== |
| @cesium/widgets | 14.3.0 | https://registry.npmjs.org/@cesium/widgets/-/widgets-14.3.0.tgz | sha512-1bS+Nv/uXwP0/NV0o4XeUA5nLCWttjTmKwl+pHnbZXp0ZwDmClb0xVDruDyVtLrUuRhsk84JZ4rXI/IT7HXOvA== |
| satellite.js | 6.0.2 | https://registry.npmjs.org/satellite.js/-/satellite.js-6.0.2.tgz | sha512-XWKxtqVF5xiJ1xAeiYeT/oSSzsukoCLWvk6nO/WFy4un0M3g4djAU9TAtOCqJLtYW9vxx9pkPJ1L9ITOc607GA== |
| mgrs | 2.1.0 | https://registry.npmjs.org/mgrs/-/mgrs-2.1.0.tgz | sha512-/pjuM02PUAhp4dazfccTSKBGTGPFkRz9LKwGJKusc/B20apcGG/CYnRHx0kXmLXy4m5O3p6y6nOVxEnErPpFvQ== |
| pbf | 5.1.2 | https://registry.npmjs.org/pbf/-/pbf-5.1.2.tgz | sha512-mnvGdvOrIvJOBGUEdGkrVXjN8E/VkIJCkf2eS1DH2yv82ORUlLttmDt0rWY38yYZmVwciZwBUvHM20qxBZf40w== |
| @mapbox/vector-tile | 3.0.0 | https://registry.npmjs.org/@mapbox/vector-tile/-/vector-tile-3.0.0.tgz | sha512-Qf10S1uIHMk20ri/IVBnpS+esUEkVaR5Hftmz88jTInrpmWgPGJfPe3LVjjlE77trLx8tH6qjTG7uWH9hIq/0Q== |
| @mapbox/point-geometry | 1.1.0 | https://registry.npmjs.org/@mapbox/point-geometry/-/point-geometry-1.1.0.tgz | sha512-YGcBz1cg4ATXDCM/71L9xveh4dynfGmcLDqufR+nQQy3fKwsAZsWd/x4621/6uJaeB9mwOHE6hPeDgXz9uViUQ== |
| rfc4648 | 1.5.4 | https://registry.npmjs.org/rfc4648/-/rfc4648-1.5.4.tgz | sha512-rRg/6Lb+IGfJqO05HZkN50UtY7K/JhxJag1kP23+zyMfrvoB0B7RWv06MbOzoc79RgCdNTiUaNsTT1AJZ7Z+cg== |
| egm96-universal | 1.1.1 | https://registry.npmjs.org/egm96-universal/-/egm96-universal-1.1.1.tgz | sha512-rHOKjWBcT2SQ1SqATOt3FdVVEkd6+n4Q+j0IDivVc/yqS0SmQ+LLUbNdCRuS6C0aibv9UXxqOyAGIyyg4E22Qg== |

Staged runtime files:

- cesium: Build/Cesium (prebuilt ESM index.js + Assets/Workers/Widgets/ThirdParty), LICENSE.md (Apache-2.0). CesiumUnminified dropped. @cesium/engine and @cesium/widgets are pre-bundled inside Build/Cesium and are not separately staged.
- satellite.js: dist/satellite.es.js, LICENSE.md (MIT)
- mgrs: dist/mgrs.esm.js, LICENSE.md (MIT)
- pbf: index.js, LICENSE (BSD-3-Clause)
- @mapbox/vector-tile: index.js, LICENSE (BSD-3-Clause)
- @mapbox/point-geometry: index.js, LICENSE (ISC)
- egm96-universal: dist/egm96-universal.esm.js, LICENSE.md (MIT)
- rfc4648: lib/rfc4648.js, LICENSE (MIT) — runtime dependency of egm96-universal, verified against its lockfile entry
