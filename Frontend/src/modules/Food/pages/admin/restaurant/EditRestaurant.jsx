import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { adminAPI, uploadAPI } from "@food/api"
import { Input } from "@food/components/ui/input"
import { Button } from "@food/components/ui/button"
import { Label } from "@food/components/ui/label"
import { loadGoogleMaps } from "@food/utils/googleMapsLoader"
import { ArrowLeft, Loader2, Upload, Image as ImageIcon } from "lucide-react"

const debugError = (..._args) => {}

const toNumberOrEmpty = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : ""
}

const isNearZero = (n) => Math.abs(Number(n) || 0) < 0.000001

const normalizeRestaurantId = (r) => r?._id || r?.id || r?.restaurantId || ""

const normalizeZoneId = (zoneId) => {
  if (!zoneId) return ""
  if (typeof zoneId === "string") return zoneId
  return zoneId?._id || zoneId?.id || ""
}

const DAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

const getDefaultOutletTimingsForm = () => ({
  Monday: { isOpen: true, openingTime: "09:00", closingTime: "22:00" },
  Tuesday: { isOpen: true, openingTime: "09:00", closingTime: "22:00" },
  Wednesday: { isOpen: true, openingTime: "09:00", closingTime: "22:00" },
  Thursday: { isOpen: true, openingTime: "09:00", closingTime: "22:00" },
  Friday: { isOpen: true, openingTime: "09:00", closingTime: "22:00" },
  Saturday: { isOpen: true, openingTime: "09:00", closingTime: "22:00" },
  Sunday: { isOpen: true, openingTime: "09:00", closingTime: "22:00" },
})

const formatTime12Hour = (time24) => {
  if (!time24) return ""
  const parts = String(time24).split(":")
  if (parts.length < 2) return time24
  const hours = parseInt(parts[0], 10)
  const minutes = parseInt(parts[1], 10)
  if (isNaN(hours) || isNaN(minutes)) return time24
  const period = hours >= 12 ? "PM" : "AM"
  const hours12 = hours % 12 || 12
  const minsPadded = minutes.toString().padStart(2, "0")
  return `${hours12.toString().padStart(2, "0")}:${minsPadded} ${period}`
}

const normalizeLocationFormFromRestaurant = (restaurant) => {
  const loc =
    restaurant?.location ||
    restaurant?.onboarding?.step1?.location ||
    {}

  const lat =
    toNumberOrEmpty(loc?.latitude ?? restaurant?.latitude)
  const lng =
    toNumberOrEmpty(loc?.longitude ?? restaurant?.longitude)

  const hasValidCoords =
    Number.isFinite(Number(lat)) &&
    Number.isFinite(Number(lng)) &&
    !isNearZero(lat) &&
    !isNearZero(lng)

  const formattedAddress =
    loc?.formattedAddress ||
    loc?.addressLine1 ||
    restaurant?.formattedAddress ||
    restaurant?.addressLine1 ||
    restaurant?.address ||
    ""

  return {
    zoneId: normalizeZoneId(restaurant?.zoneId),
    formattedAddress,
    addressLine1: loc?.addressLine1 || restaurant?.addressLine1 || formattedAddress,
    addressLine2: loc?.addressLine2 || restaurant?.addressLine2 || "",
    area: loc?.area || restaurant?.area || "",
    city: loc?.city || restaurant?.city || "",
    state: loc?.state || restaurant?.state || "",
    pincode: loc?.pincode || restaurant?.pincode || "",
    landmark: loc?.landmark || restaurant?.landmark || "",
    latitude: hasValidCoords ? lat : "",
    longitude: hasValidCoords ? lng : "",
  }
}

const normalizeDetailsFormFromRestaurant = (restaurant) => {
  return {
    name: restaurant?.name || restaurant?.restaurantName || "",
    pureVegRestaurant:
      typeof restaurant?.pureVegRestaurant === "boolean"
        ? restaurant.pureVegRestaurant
        : false,
    ownerName: restaurant?.ownerName || "",
    ownerEmail: restaurant?.ownerEmail || "",
    ownerPhone: restaurant?.ownerPhone || "",
    primaryContactNumber: restaurant?.primaryContactNumber || "",
    email: restaurant?.email || "",
    cuisinesText: Array.isArray(restaurant?.cuisines) ? restaurant.cuisines.join(", ") : "",
    estimatedDeliveryTimeMinutes:
      restaurant?.estimatedDeliveryTimeMinutes ??
      restaurant?.estimatedDeliveryTime ??
      "",
    offer: restaurant?.offer || "",
    openingTime: restaurant?.openingTime || restaurant?.deliveryTimings?.openingTime || "",
    closingTime: restaurant?.closingTime || restaurant?.deliveryTimings?.closingTime || "",
    isActive: restaurant?.isActive !== false,
    isAcceptingOrders: restaurant?.isAcceptingOrders !== undefined ? Boolean(restaurant.isAcceptingOrders) : true,
  }
}

async function loadGooglePlaces() {
  // Uses the shared loader so this page cannot race with, or tear down, the
  // script another component already loaded.
  const google = await loadGoogleMaps()
  return Boolean(google?.maps?.places?.Autocomplete)
}

export default function EditRestaurant() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [savingDetails, setSavingDetails] = useState(false)
  const [savingLocation, setSavingLocation] = useState(false)
  const [error, setError] = useState("")

  const [restaurant, setRestaurant] = useState(null)
  const [zones, setZones] = useState([])
  const [zonesLoading, setZonesLoading] = useState(false)

  const [detailsForm, setDetailsForm] = useState(() => normalizeDetailsFormFromRestaurant(null))
  const [outletTimingsForm, setOutletTimingsForm] = useState(getDefaultOutletTimingsForm)
  const [locationForm, setLocationForm] = useState(() => normalizeLocationFormFromRestaurant(null))
  const [locationError, setLocationError] = useState("")
  const [profileImageFile, setProfileImageFile] = useState(null)
  const [profileImagePreview, setProfileImagePreview] = useState("")

  const locationSearchInputRef = useRef(null)
  const placesAutocompleteRef = useRef(null)

  const restaurantId = useMemo(() => {
    if (id) return id
    return normalizeRestaurantId(restaurant)
  }, [id, restaurant])

  useEffect(() => {
    let mounted = true
    const run = async () => {
      if (!restaurantId) return
      try {
        setLoading(true)
        setError("")

        const [res, timingsRes] = await Promise.all([
          adminAPI.getRestaurantById(restaurantId).catch(() => null),
          adminAPI.getRestaurantOutletTimings(restaurantId).catch(() => null),
        ])

        const data = res?.data?.data || null
        if (!mounted) return
        if (!res?.data?.success || !data) {
          setError(res?.data?.message || "Failed to load restaurant")
          setRestaurant(null)
          return
        }

        setRestaurant(data)
        setDetailsForm(normalizeDetailsFormFromRestaurant(data))
        const img = data?.profileImage?.url || data?.profileImage || ""
        setProfileImagePreview(img)
        setLocationForm(normalizeLocationFormFromRestaurant(data))

        const timings = timingsRes?.data?.data?.outletTimings
        if (timings && typeof timings === "object" && !Array.isArray(timings)) {
          setOutletTimingsForm({ ...getDefaultOutletTimingsForm(), ...timings })
        } else {
          setOutletTimingsForm(getDefaultOutletTimingsForm())
        }
      } catch (e) {
        debugError(e)
        if (!mounted) return
        setError(e?.response?.data?.message || "Failed to load restaurant")
      } finally {
        if (mounted) setLoading(false)
      }
    }
    run()
    return () => {
      mounted = false
    }
  }, [restaurantId])

  useEffect(() => {
    let mounted = true
    setZonesLoading(true)
    adminAPI
      .getZones({ limit: 1000 })
      .then((res) => {
        const list =
          res?.data?.data?.zones ||
          res?.data?.data?.data?.zones ||
          res?.data?.data ||
          []
        if (!mounted) return
        setZones(Array.isArray(list) ? list : [])
      })
      .catch(() => {
        if (!mounted) return
        setZones([])
      })
      .finally(() => {
        if (!mounted) return
        setZonesLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (!locationSearchInputRef.current) return
    if (placesAutocompleteRef.current) return

    let cancelled = false
    const init = async () => {
      setLocationError("")
      const loaded = await loadGooglePlaces()
      if (cancelled) return
      if (!loaded || !window.google?.maps?.places?.Autocomplete) {
        setLocationError("Unable to load Google Places Autocomplete.")
        return
      }

      placesAutocompleteRef.current = new window.google.maps.places.Autocomplete(
        locationSearchInputRef.current,
        {
          fields: ["formatted_address", "address_components", "geometry"],
          // Omit `types: ["geocode"]` — that biases Autocomplete toward Geocoding API (geocode/json) traffic.
          componentRestrictions: { country: "in" },
        },
      )

      const parsePlace = (place) => {
        const formattedAddress = place?.formatted_address || ""
        const comps = Array.isArray(place?.address_components) ? place.address_components : []
        const get = (types) =>
          comps.find((c) => types.some((t) => c.types?.includes(t)))?.long_name || ""
        const area =
          get(["sublocality_level_1", "sublocality", "neighborhood"]) ||
          get(["locality"])
        const city =
          get(["locality"]) ||
          get(["administrative_area_level_2"])
        const state = get(["administrative_area_level_1"])
        const pincode = get(["postal_code"])
        const lat = place?.geometry?.location?.lat?.()
        const lng = place?.geometry?.location?.lng?.()

        return {
          formattedAddress,
          area,
          city,
          state,
          pincode,
          latitude: Number.isFinite(lat) ? Number(lat.toFixed(6)) : "",
          longitude: Number.isFinite(lng) ? Number(lng.toFixed(6)) : "",
        }
      }

      placesAutocompleteRef.current.addListener("place_changed", () => {
        const place = placesAutocompleteRef.current.getPlace()
        const parsed = parsePlace(place)
        setLocationForm((prev) => ({
          ...prev,
          formattedAddress: parsed.formattedAddress || prev.formattedAddress,
          addressLine1: parsed.formattedAddress || prev.addressLine1,
          area: parsed.area || prev.area,
          city: parsed.city || prev.city,
          state: parsed.state || prev.state,
          pincode: parsed.pincode || prev.pincode,
          latitude: parsed.latitude !== "" ? parsed.latitude : prev.latitude,
          longitude: parsed.longitude !== "" ? parsed.longitude : prev.longitude,
        }))
      })
    }

    requestAnimationFrame(init)
    return () => {
      cancelled = true
      placesAutocompleteRef.current = null
    }
  }, [])

  const currentZoneLabel = useMemo(() => {
    const zid = normalizeZoneId(locationForm.zoneId)
    if (!zid) return ""
    const z = zones.find((x) => normalizeZoneId(x?._id || x?.id) === zid)
    return z?.name || z?.zoneName || ""
  }, [locationForm.zoneId, zones])

  const handleSaveDetails = async () => {
    if (!restaurantId) return
    if (!profileImagePreview && !profileImageFile) {
      alert("Restaurant profile image is required")
      return
    }

    try {
      setSavingDetails(true)

      let profileImage = undefined
      if (profileImageFile) {
        const uploadRes = await uploadAPI.uploadMedia(profileImageFile, {
          folder: "dooriq/restaurant/profile",
        })
        const media = uploadRes?.data?.data?.file || uploadRes?.data?.data || uploadRes?.data?.file
        if (media?.url) {
          profileImage = { url: media.url, publicId: media.publicId || media.public_id }
        }
      }

      const cuisines = String(detailsForm.cuisinesText || "")
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean)

      const payload = {
        name: detailsForm.name,
        pureVegRestaurant: detailsForm.pureVegRestaurant === true,
        ownerName: detailsForm.ownerName,
        ownerEmail: detailsForm.ownerEmail,
        ownerPhone: detailsForm.ownerPhone,
        primaryContactNumber: detailsForm.primaryContactNumber,
        email: detailsForm.email,
        cuisines,
        estimatedDeliveryTimeMinutes:
          detailsForm.estimatedDeliveryTimeMinutes === ""
            ? undefined
            : Number(detailsForm.estimatedDeliveryTimeMinutes),
        offer: detailsForm.offer,
        openingTime: detailsForm.openingTime,
        closingTime: detailsForm.closingTime,
        isActive: detailsForm.isActive !== false,
        isAcceptingOrders: detailsForm.isAcceptingOrders === true,
      }

      if (profileImage) {
        payload.profileImage = profileImage
      }

      const res = await adminAPI.updateRestaurant(restaurantId, payload)
      try {
        await adminAPI.updateRestaurantOutletTimings(restaurantId, outletTimingsForm)
      } catch (err) {
        debugError("Failed to save outlet timings:", err)
      }
      const updated = res?.data?.data?.restaurant || res?.data?.data || null
      if (updated) {
        setRestaurant((prev) => ({ ...(prev || {}), ...updated }))
        const img = updated?.profileImage?.url || updated?.profileImage || ""
        if (img) {
          setProfileImagePreview(img)
          setProfileImageFile(null)
        }
      }
      alert("Restaurant details updated successfully")
    } catch (e) {
      alert(e?.response?.data?.message || "Failed to update restaurant details")
    } finally {
      setSavingDetails(false)
    }
  }

  const handleSaveLocation = async () => {
    if (!restaurantId) return

    const latitude = Number(locationForm.latitude)
    const longitude = Number(locationForm.longitude)

    if (!locationForm.zoneId) {
      alert("Please select a zone")
      return
    }
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !locationForm.formattedAddress) {
      alert("Please select a location from dropdown")
      return
    }

    try {
      setSavingLocation(true)
      const payload = {
        zoneId: locationForm.zoneId,
        latitude,
        longitude,
        coordinates: [longitude, latitude],
        formattedAddress: locationForm.formattedAddress || "",
        address: locationForm.formattedAddress || "",
        addressLine1: locationForm.addressLine1 || locationForm.formattedAddress || "",
        addressLine2: locationForm.addressLine2 || "",
        area: locationForm.area || "",
        city: locationForm.city || "",
        state: locationForm.state || "",
        landmark: locationForm.landmark || "",
        pincode: locationForm.pincode || "",
        zipCode: locationForm.pincode || "",
        postalCode: locationForm.pincode || "",
      }

      const res = await adminAPI.updateRestaurantLocation(restaurantId, payload)
      const updatedRestaurant = res?.data?.data?.restaurant || null
      if (updatedRestaurant) {
        setRestaurant((prev) => ({ ...(prev || {}), ...updatedRestaurant }))
      }
      alert("Restaurant location updated successfully")
    } catch (e) {
      alert(e?.response?.data?.message || "Failed to update restaurant location")
    } finally {
      setSavingLocation(false)
    }
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/admin/food/restaurants")}
              className="p-2 rounded-lg bg-white border border-slate-200 hover:bg-slate-50"
              title="Back"
            >
              <ArrowLeft className="w-4 h-4 text-slate-700" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Edit Restaurant</h1>
              <p className="text-sm text-slate-500">
                {restaurant?.name || restaurant?.restaurantName || restaurantId}
              </p>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="bg-white rounded-xl border border-slate-200 p-10 flex items-center justify-center gap-2 text-slate-600">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading...
          </div>
        ) : error ? (
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        ) : (
          <div className="space-y-6">
            <section className="bg-white rounded-xl border border-slate-200 p-6">
              <div className="flex items-center justify-between gap-3 mb-4">
                <h2 className="text-lg font-semibold text-slate-900">Basic Details</h2>
                <Button onClick={handleSaveDetails} disabled={savingDetails}>
                  {savingDetails ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving...
                    </span>
                  ) : (
                    "Save Details"
                  )}
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <Label>Profile Image <span className="text-red-500">*</span></Label>
                  <div className="flex items-center gap-4 mt-1">
                    <div className="w-24 h-24 rounded-xl overflow-hidden bg-slate-100 border border-slate-200">
                      {profileImagePreview ? (
                        <img src={profileImagePreview} alt="Profile preview" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-400">
                          <ImageIcon className="w-6 h-6" />
                        </div>
                      )}
                    </div>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        setProfileImageFile(file || null)
                        if (file) {
                          const localUrl = URL.createObjectURL(file)
                          setProfileImagePreview(localUrl)
                        }
                      }}
                      className="block w-full text-sm text-slate-700 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200"
                    />
                  </div>
                </div>
                {/* Manual Restaurant Status (ON / OFF) */}
                <div className="md:col-span-2 p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div>
                    <Label className="text-base font-semibold text-slate-900 block">Manual Restaurant Status (Accepting Orders)</Label>
                    <p className="text-xs text-slate-500">Turn restaurant manually ON (Online & Accepting Orders) or OFF (Offline & Not Accepting Orders)</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setDetailsForm((p) => ({ ...p, isAcceptingOrders: !p.isAcceptingOrders }))}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${detailsForm.isAcceptingOrders ? "bg-emerald-600" : "bg-slate-300"}`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${detailsForm.isAcceptingOrders ? "translate-x-5" : "translate-x-0"}`}
                      />
                    </button>
                    <span className={`text-xs font-bold px-3 py-1 rounded-full ${detailsForm.isAcceptingOrders ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>
                      {detailsForm.isAcceptingOrders ? "ON (Online)" : "OFF (Offline)"}
                    </span>
                  </div>
                </div>

                <div>
                  <Label>Restaurant Name</Label>
                  <Input value={detailsForm.name} onChange={(e) => setDetailsForm((p) => ({ ...p, name: e.target.value }))} />
                </div>
                <div>
                  <Label>Pure Veg</Label>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setDetailsForm((p) => ({ ...p, pureVegRestaurant: true }))}
                      className={`px-3 py-1.5 text-xs rounded-full border ${
                        detailsForm.pureVegRestaurant === true
                          ? "bg-green-600 text-white border-green-600"
                          : "bg-white text-slate-700 border-slate-300"
                      }`}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => setDetailsForm((p) => ({ ...p, pureVegRestaurant: false }))}
                      className={`px-3 py-1.5 text-xs rounded-full border ${
                        detailsForm.pureVegRestaurant === false
                          ? "bg-slate-900 text-white border-slate-900"
                          : "bg-white text-slate-700 border-slate-300"
                      }`}
                    >
                      No
                    </button>
                  </div>
                </div>
                <div>
                  <Label>Primary Email</Label>
                  <Input value={detailsForm.email} onChange={(e) => setDetailsForm((p) => ({ ...p, email: e.target.value }))} />
                </div>
                <div>
                  <Label>Owner Name</Label>
                  <Input value={detailsForm.ownerName} onChange={(e) => setDetailsForm((p) => ({ ...p, ownerName: e.target.value }))} />
                </div>
                <div>
                  <Label>Owner Email</Label>
                  <Input value={detailsForm.ownerEmail} onChange={(e) => setDetailsForm((p) => ({ ...p, ownerEmail: e.target.value }))} />
                </div>
                <div>
                  <Label>Owner Phone</Label>
                  <Input value={detailsForm.ownerPhone} onChange={(e) => setDetailsForm((p) => ({ ...p, ownerPhone: e.target.value }))} />
                </div>
                <div>
                  <Label>Primary Contact Number</Label>
                  <Input value={detailsForm.primaryContactNumber} onChange={(e) => setDetailsForm((p) => ({ ...p, primaryContactNumber: e.target.value }))} />
                </div>
                <div className="md:col-span-2">
                  <Label>Cuisines (comma separated)</Label>
                  <Input value={detailsForm.cuisinesText} onChange={(e) => setDetailsForm((p) => ({ ...p, cuisinesText: e.target.value }))} />
                </div>
                <div>
                  <Label>Estimated Delivery Time (minutes)</Label>
                  <Input
                    type="number"
                    value={detailsForm.estimatedDeliveryTimeMinutes}
                    onChange={(e) => setDetailsForm((p) => ({ ...p, estimatedDeliveryTimeMinutes: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Offer</Label>
                  <Input value={detailsForm.offer} onChange={(e) => setDetailsForm((p) => ({ ...p, offer: e.target.value }))} />
                </div>
              </div>
            </section>

            {/* Day-Wise Outlet Timings Section */}
            <section className="bg-white rounded-xl border border-slate-200 p-6">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Day-wise Outlet Timings</h2>
                  <p className="text-xs text-slate-500 mt-1">Configure opening & closing hours for each day of the week</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const mondayTiming = outletTimingsForm["Monday"] || { isOpen: true, openingTime: "09:00", closingTime: "22:00" }
                    const copied = {}
                    DAY_ORDER.forEach((day) => { copied[day] = { ...mondayTiming } })
                    setOutletTimingsForm(copied)
                  }}
                >
                  Copy Monday to All Days
                </Button>
              </div>

              <div className="space-y-3">
                {DAY_ORDER.map((day) => {
                  const dayData = outletTimingsForm[day] || { isOpen: true, openingTime: "09:00", closingTime: "22:00" }
                  return (
                    <div key={day} className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-xl border border-slate-200 bg-slate-50 gap-3">
                      <div className="flex items-center gap-3 w-36">
                        <input
                          type="checkbox"
                          id={`edit-page-day-open-${day}`}
                          checked={dayData.isOpen !== false}
                          onChange={(e) => {
                            const isOpen = e.target.checked
                            setOutletTimingsForm((prev) => ({
                              ...prev,
                              [day]: {
                                ...prev[day],
                                isOpen,
                                openingTime: isOpen ? (prev[day]?.openingTime || "09:00") : "",
                                closingTime: isOpen ? (prev[day]?.closingTime || "22:00") : "",
                              },
                            }))
                          }}
                          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                        <label htmlFor={`edit-page-day-open-${day}`} className="text-sm font-semibold text-slate-800 cursor-pointer">
                          {day}
                        </label>
                      </div>

                      {dayData.isOpen !== false ? (
                        <div className="flex items-center gap-3 flex-1">
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-1">
                              <Label className="block text-[10px] text-slate-500 uppercase font-medium">Opening Time</Label>
                              <span className="text-[11px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">
                                {formatTime12Hour(dayData.openingTime || "09:00")}
                              </span>
                            </div>
                            <Input
                              type="time"
                              value={dayData.openingTime || "09:00"}
                              onChange={(e) => {
                                const time = e.target.value
                                setOutletTimingsForm((prev) => ({
                                  ...prev,
                                  [day]: { ...prev[day], openingTime: time },
                                }))
                              }}
                              className="bg-white"
                            />
                          </div>
                          <span className="text-slate-400 font-bold self-end pb-2">to</span>
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-1">
                              <Label className="block text-[10px] text-slate-500 uppercase font-medium">Closing Time</Label>
                              <span className="text-[11px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100">
                                {formatTime12Hour(dayData.closingTime || "22:00")}
                              </span>
                            </div>
                            <Input
                              type="time"
                              value={dayData.closingTime || "22:00"}
                              onChange={(e) => {
                                const time = e.target.value
                                setOutletTimingsForm((prev) => ({
                                  ...prev,
                                  [day]: { ...prev[day], closingTime: time },
                                }))
                              }}
                              className="bg-white"
                            />
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs font-semibold text-rose-600 bg-rose-50 px-3 py-2 rounded-lg border border-rose-100 flex-1 text-center sm:text-left">
                          Closed for orders on {day}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>

            <section className="bg-white rounded-xl border border-slate-200 p-6">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Location</h2>
                  {currentZoneLabel ? (
                    <p className="text-xs text-slate-500 mt-1">Current Zone: {currentZoneLabel}</p>
                  ) : null}
                </div>
                <Button onClick={handleSaveLocation} disabled={savingLocation}>
                  {savingLocation ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving...
                    </span>
                  ) : (
                    "Save Location"
                  )}
                </Button>
              </div>

              {locationError ? (
                <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {locationError}
                </div>
              ) : null}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <Label>Service Zone</Label>
                  <select
                    value={locationForm.zoneId || ""}
                    onChange={(e) => setLocationForm((p) => ({ ...p, zoneId: e.target.value }))}
                    className="mt-1 h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
                    disabled={zonesLoading}
                  >
                    <option value="">{zonesLoading ? "Loading zones..." : "Select a zone"}</option>
                    {zones.map((z) => {
                      const zid = normalizeZoneId(z?._id || z?.id)
                      const label = z?.name || z?.zoneName || zid
                      return (
                        <option key={zid} value={zid}>
                          {label}
                        </option>
                      )
                    })}
                  </select>
                </div>

                <div className="md:col-span-2">
                  <Label>Search location</Label>
                  <Input
                    ref={locationSearchInputRef}
                    placeholder="Start typing your restaurant address..."
                    className="mt-1 bg-white text-sm text-black! dark:text-white! placeholder:text-gray-500 dark:placeholder:text-gray-400 caret-black dark:caret-white"
                    style={{ color: "#000", WebkitTextFillColor: "#000" }}
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Select a suggestion from the dropdown to fill address + coordinates.
                  </p>
                </div>

                <div className="md:col-span-2">
                  <Label>Formatted Address</Label>
                  <Input value={locationForm.formattedAddress} readOnly className="mt-1 bg-slate-50" />
                </div>
                <div>
                  <Label>Area</Label>
                  <Input value={locationForm.area} readOnly className="mt-1 bg-slate-50" />
                </div>
                <div>
                  <Label>City</Label>
                  <Input value={locationForm.city} readOnly className="mt-1 bg-slate-50" />
                </div>
                <div>
                  <Label>State</Label>
                  <Input value={locationForm.state} readOnly className="mt-1 bg-slate-50" />
                </div>
                <div>
                  <Label>Pincode</Label>
                  <Input value={locationForm.pincode} readOnly className="mt-1 bg-slate-50" />
                </div>
                <div className="md:col-span-2">
                  <Label>Landmark</Label>
                  <Input
                    value={locationForm.landmark}
                    onChange={(e) => setLocationForm((p) => ({ ...p, landmark: e.target.value }))}
                    className="mt-1"
                  />
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

