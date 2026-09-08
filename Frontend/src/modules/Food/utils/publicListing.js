export const getValidLatLng = (location) => {
  const lat = Number(location?.latitude ?? location?.lat)
  const lng = Number(location?.longitude ?? location?.lng)

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null
  }

  return { lat, lng }
}

export const hasValidLatLng = (location) => getValidLatLng(location) !== null

export const buildRadiusListingParams = (location, extraParams = {}) => {
  const coords = getValidLatLng(location)
  if (!coords) return null

  return {
    ...extraParams,
    lat: coords.lat,
    lng: coords.lng,
  }
}

export const mapPublicCategories = (
  rawCategories = [],
  { fallbackImages = [], resolveImage } = {},
) => {
  if (!Array.isArray(rawCategories)) return []

  return rawCategories
    .map((category, index) => {
      const name = String(category?.name || "").trim()
      if (!name) return null

      const rawImage =
        category?.image ||
        category?.imageUrl ||
        category?.icon ||
        ""

      const normalizedImage =
        typeof resolveImage === "function"
          ? resolveImage(rawImage)
          : rawImage

      return {
        id: String(category?.id || category?._id || category?.slug || index),
        name,
        slug: category?.slug || name.toLowerCase().replace(/\s+/g, "-"),
        image:
          normalizedImage ||
          fallbackImages[index % Math.max(1, fallbackImages.length)] ||
          "",
        type: category?.type || "",
      }
    })
    .filter(Boolean)
}

export const buildCategoryKeywords = (categories = []) => {
  if (!Array.isArray(categories)) return {}

  return categories.reduce((keywords, category) => {
    const id = String(category?.slug || category?.id || category?._id || "").trim()
    const name = String(category?.name || "").trim().toLowerCase()
    if (!id || !name) return keywords

    const words = name.split(/[\s-]+/).filter(Boolean)
    keywords[id] = Array.from(new Set([name, ...words]))
    return keywords
  }, {})
}

export const formatListingDistance = (value) => {
  const distance = Number(value)
  if (!Number.isFinite(distance)) return ""

  return distance >= 1
    ? `${distance.toFixed(1)} km`
    : `${Math.round(distance * 1000)} m`
}
