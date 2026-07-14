import { downloadPDF } from "../commonPDFExport"
// Export utility functions for zones
export const exportZonesToCSV = (zones, filename = "zones") => {
  const headers = ["SI", "Zone ID", "Name", "Display Name", "Restaurants", "Deliverymen", "Default Status", "Status"]
  const rows = zones.map((zone, index) => [
    index + 1,
    zone.zoneId,
    zone.name,
    zone.displayName,
    zone.restaurants,
    zone.deliverymen,
    zone.isDefault ? "Yes" : "No",
    zone.status ? "Active" : "Inactive"
  ])
  
  const csvContent = [
    headers.join(","),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(","))
  ].join("\n")
  
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
  const link = document.createElement("a")
  const url = URL.createObjectURL(blob)
  link.setAttribute("href", url)
  link.setAttribute("download", `${filename}_${new Date().toISOString().split("T")[0]}.csv`)
  link.style.visibility = "hidden"
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

export const exportZonesToExcel = (zones, filename = "zones") => {
  const headers = ["SI", "Zone ID", "Name", "Display Name", "Restaurants", "Deliverymen", "Default Status", "Status"]
  const rows = zones.map((zone, index) => [
    index + 1,
    zone.zoneId,
    zone.name,
    zone.displayName,
    zone.restaurants,
    zone.deliverymen,
    zone.isDefault ? "Yes" : "No",
    zone.status ? "Active" : "Inactive"
  ])
  
  const csvContent = [
    headers.join("\t"),
    ...rows.map(row => row.join("\t"))
  ].join("\n")
  
  const blob = new Blob([csvContent], { type: "application/vnd.ms-excel" })
  const link = document.createElement("a")
  const url = URL.createObjectURL(blob)
  link.setAttribute("href", url)
  link.setAttribute("download", `${filename}_${new Date().toISOString().split("T")[0]}.xls`)
  link.style.visibility = "hidden"
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

export const exportZonesToPDF = async (zones, filename = "zones") => {
  const headers = ["SI", "Zone ID", "Name", "Display Name", "Restaurants", "Deliverymen", "Default Status", "Status"]
  const rows = zones.map((zone, index) => [
    index + 1,
    zone.zoneId,
    zone.name,
    zone.displayName,
    zone.restaurants,
    zone.deliverymen,
    zone.isDefault ? "Yes" : "No",
    zone.status ? "Active" : "Inactive"
  ])
  
  await downloadPDF({ headers, rows, filename, title: "Zones Report" })
}

export const exportZonesToJSON = (zones, filename = "zones") => {
  const jsonContent = JSON.stringify(zones, null, 2)
  const blob = new Blob([jsonContent], { type: "application/json" })
  const link = document.createElement("a")
  const url = URL.createObjectURL(blob)
  link.setAttribute("href", url)
  link.setAttribute("download", `${filename}_${new Date().toISOString().split("T")[0]}.json`)
  link.style.visibility = "hidden"
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

