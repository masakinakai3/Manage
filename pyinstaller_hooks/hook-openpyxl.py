"""Keep the bundled openpyxl graph focused on workbook writing."""

hiddenimports = [
    "openpyxl.cell._writer",
    "openpyxl.workbook.workbook",
    "openpyxl.writer.excel",
    "openpyxl.worksheet._writer",
    "openpyxl.worksheet.worksheet",
]

excludedimports = [
    "openpyxl.chart",
    "openpyxl.chartsheet",
    "openpyxl.comments",
    "openpyxl.drawing",
    "openpyxl.pivot",
    "openpyxl.reader",
]
