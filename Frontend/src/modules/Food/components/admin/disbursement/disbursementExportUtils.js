import { downloadPDF } from "../commonPDFExport"
// Export utility functions for disbursements
export const exportDisbursementsToCSV = (disbursements, filename = "disbursements") => {
  const headers = ["ID", "Status", "Total Amount", "Created At"]
  const rows = disbursements.map((disbursement) => [
    disbursement.id,
    disbursement.status,
    `$${disbursement.totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    disbursement.createdAt
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

export const exportDisbursementsToExcel = (disbursements, filename = "disbursements") => {
  const headers = ["ID", "Status", "Total Amount", "Created At"]
  const rows = disbursements.map((disbursement) => [
    disbursement.id,
    disbursement.status,
    `$${disbursement.totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    disbursement.createdAt
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

export const exportDisbursementsToPDF = async (disbursements, filename = "disbursements") => {
  const headers = ["ID", "Status", "Total Amount", "Created At"]
  const rows = disbursements.map((disbursement) => [
    disbursement.id,
    disbursement.status,
    `$${disbursement.totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    disbursement.createdAt
  ])
  
  await downloadPDF({ headers, rows, filename, title: "Disbursements Report" })
}

export const exportDisbursementsToJSON = (disbursements, filename = "disbursements") => {
  const jsonContent = JSON.stringify(disbursements, null, 2)
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

