import { downloadPDF } from "../commonPDFExport"
// Export utility functions for commission rules
export const exportCommissionToCSV = (commissions, filename = "delivery-boy-commission") => {
  const headers = ["SI", "Name", "Min Distance (km)", "Max Distance (km)", "Commission Per Km (₹)", "Base Payout (₹)", "Status"]
  const rows = commissions.map((commission) => [
    commission.sl,
    commission.name,
    commission.minDistance,
    commission.maxDistance === null ? "Unlimited" : commission.maxDistance,
    commission.commissionPerKm,
    commission.basePayout,
    commission.status ? "Active" : "Inactive"
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

export const exportCommissionToExcel = (commissions, filename = "delivery-boy-commission") => {
  const headers = ["SI", "Name", "Min Distance (km)", "Max Distance (km)", "Commission Per Km (₹)", "Base Payout (₹)", "Status"]
  const rows = commissions.map((commission) => [
    commission.sl,
    commission.name,
    commission.minDistance,
    commission.maxDistance === null ? "Unlimited" : commission.maxDistance,
    commission.commissionPerKm,
    commission.basePayout,
    commission.status ? "Active" : "Inactive"
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

export const exportCommissionToPDF = async (commissions, filename = "delivery-boy-commission") => {
  const headers = ["SI", "Name", "Min Distance (km)", "Max Distance (km)", "Commission Per Km (Rs.)", "Base Payout (Rs.)", "Status"]
  const rows = commissions.map((commission) => [
    commission.sl,
    commission.name,
    commission.minDistance,
    commission.maxDistance === null ? "Unlimited" : commission.maxDistance,
    `Rs.${commission.commissionPerKm}`,
    `Rs.${commission.basePayout}`,
    commission.status ? "Active" : "Inactive"
  ])
  
  await downloadPDF({ headers, rows, filename, title: "Delivery Boy Commission Report" })
}

export const exportCommissionToJSON = (commissions, filename = "delivery-boy-commission") => {
  const jsonContent = JSON.stringify(commissions, null, 2)
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

