import { downloadPDF } from "../commonPDFExport"
// Export utility functions for campaigns
export const exportCampaignsToCSV = (campaigns, filename = "campaigns", isFoodCampaign = false) => {
  let headers, rows
  
  if (isFoodCampaign) {
    headers = ["SI", "Title", "Date Start", "Date End", "Time Start", "Time End", "Price", "Status"]
    rows = campaigns.map((campaign, index) => [
      index + 1,
      campaign.title,
      campaign.dateStart,
      campaign.dateEnd,
      campaign.timeStart,
      campaign.timeEnd,
      `$ ${(campaign.price || 0).toFixed(2)}`,
      campaign.status ? "Active" : "Inactive"
    ])
  } else {
    headers = ["SI", "Title", "Date Start", "Date End", "Time Start", "Time End", "Status"]
    rows = campaigns.map((campaign, index) => [
      index + 1,
      campaign.title,
      campaign.dateStart,
      campaign.dateEnd,
      campaign.timeStart,
      campaign.timeEnd,
      campaign.status ? "Active" : "Inactive"
    ])
  }
  
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

export const exportCampaignsToExcel = (campaigns, filename = "campaigns", isFoodCampaign = false) => {
  let headers, rows
  
  if (isFoodCampaign) {
    headers = ["SI", "Title", "Date Start", "Date End", "Time Start", "Time End", "Price", "Status"]
    rows = campaigns.map((campaign, index) => [
      index + 1,
      campaign.title,
      campaign.dateStart,
      campaign.dateEnd,
      campaign.timeStart,
      campaign.timeEnd,
      `$ ${(campaign.price || 0).toFixed(2)}`,
      campaign.status ? "Active" : "Inactive"
    ])
  } else {
    headers = ["SI", "Title", "Date Start", "Date End", "Time Start", "Time End", "Status"]
    rows = campaigns.map((campaign, index) => [
      index + 1,
      campaign.title,
      campaign.dateStart,
      campaign.dateEnd,
      campaign.timeStart,
      campaign.timeEnd,
      campaign.status ? "Active" : "Inactive"
    ])
  }
  
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

export const exportCampaignsToPDF = async (campaigns, filename = "campaigns", isFoodCampaign = false) => {
  let headers, rows
  
  if (isFoodCampaign) {
    headers = ["SI", "Title", "Date Start", "Date End", "Time Start", "Time End", "Price", "Status"]
    rows = campaigns.map((campaign, index) => [
      index + 1,
      campaign.title,
      campaign.dateStart,
      campaign.dateEnd,
      campaign.timeStart,
      campaign.timeEnd,
      `$ ${(campaign.price || 0).toFixed(2)}`,
      campaign.status ? "Active" : "Inactive"
    ])
  } else {
    headers = ["SI", "Title", "Date Start", "Date End", "Time Start", "Time End", "Status"]
    rows = campaigns.map((campaign, index) => [
      index + 1,
      campaign.title,
      campaign.dateStart,
      campaign.dateEnd,
      campaign.timeStart,
      campaign.timeEnd,
      campaign.status ? "Active" : "Inactive"
    ])
  }
  
  await downloadPDF({ headers, rows, filename, title: "Campaigns Report" })
}

export const exportCampaignsToJSON = (campaigns, filename = "campaigns") => {
  const jsonContent = JSON.stringify(campaigns, null, 2)
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

