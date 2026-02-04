
import csv
import json
import sys
from datetime import datetime

# Input/Output Config
INPUT_CSV = 'auctions_latest_export.csv'
OUTPUT_CSV = 'tesla_data_with_highland_flag.csv'

# Target Headers (matching the original file)
HEADERS = [
    'make', 'model', 'variant', 'mileage', 'first_registration', 'powe_kw', 
    'drive_type', 'features_autopilot', 'tires_summer', 'tires_winter', 
    'tires_all_season', 'tires_total_sets', 'features_heatpump', 
    'features_pano_roof', 'features_trailer_hitch', 'battery_netto', 
    'battery_brutto', 'color', 'upholstery', 'taxation', 'accident_free', 
    'number_of_keys', 'damage_description', 'auction_start_date', 
    'auction_end_date', 'status', 'highest_bid_price', 'number_of_bids', 
    'list_price', 'acc', 'number_of_seats', 'electric_seats', 'leather_seats', 
    'head_up_display', 'seat_heating', 'sport_seat_type', 'heated_steering_wheel', 
    'sport_steering_wheel', 'leather_steering_wheel', 'camera_type', 
    'trailer_hitch_seller', 'paint_color', 'upholstery', 'equipment', 
    'charging_cables', 'document_type', 'documents', 'form_of_ownership', 
    'seller_type', 'special_equipment_price', 'accident_free_cardentity', 
    'service_maintained', 'smoker_car', 'pet_car', 'auction_id', 
    'auction_short_id', 'auction_sequence', 'activated_at', 
    'auction_created_at', 'highest_bider_id', 'highest_bid_at', 
    'bids_count_calc', 'max_bid_offer_amount', 'min_bid_offer_amount', 
    'last_bid_at', 'is_highland', 'highland_logic_reason'
]

def parse_json_safe(json_str):
    try:
        return json.loads(json_str)
    except:
        return []

def get_highland_status(row):
    """
    Determines if a Model 3 is the Highland facelift.
    """
    model = row.get('model', '')
    variant = row.get('variant', '')
    reg_date = row.get('first_registration', '')

    if model != 'Model 3':
        return "FALSE", "Not Model 3"

    # 1. Explicit Label in Variant
    if 'highland' in variant.lower():
        return "TRUE", "Labeled Highland"

    # User Request: If it's not labeled Highland, it's NOT Highland. 
    # Even if date is late 2023/2024.
    return "FALSE", "Not Labeled Highland"

def transform_row(row):
    # Only Tesla Model 3 and Y
    make = row.get('make', '')
    model = row.get('model', '')
    if make != 'Tesla' or model not in ['Model 3', 'Model Y']:
        return None

    new_row = {k: '' for k in HEADERS}
    
    # Direct mappings (New CSV Col -> Old CSV Col)
    new_row['make'] = make
    new_row['model'] = model
    new_row['variant'] = row.get('variant')
    new_row['mileage'] = row.get('mileage')
    new_row['first_registration'] = row.get('first_registration')
    new_row['powe_kw'] = row.get('power_kw')
    new_row['drive_type'] = row.get('drive_type')
    new_row['features_autopilot'] = row.get('tesla_autopilot')
    
    # Simple Renames
    new_row['features_heatpump'] = row.get('heatpump')
    new_row['features_pano_roof'] = row.get('panorama_roof')
    new_row['features_trailer_hitch'] = row.get('trailer_hitch')
    new_row['battery_netto'] = row.get('battery_capacity_netto')
    new_row['battery_brutto'] = row.get('battery_capacity_brutto')
    # color mapping? 'paint_color' exists in both, 'color' was empty in old head
    new_row['paint_color'] = row.get('paint_color') 
    
    new_row['taxation'] = row.get('taxation')
    new_row['accident_free'] = row.get('accident_free_seller') # Or cardentity? Old head had 'accident_free' and 'accident_free_cardentity'
    # Wait, old csv had 'accident_free' populated with 't' in the dump.
    # New csv has 'accident_free_seller' and 'accident_free_cardentity'.
    # I will map 'accident_free_seller' to 'accident_free' to be consistent with common usage?
    # Actually, let's map both specific fields first.
    new_row['accident_free_cardentity'] = row.get('accident_free_cardentity')
    # The 'accident_free' column in old CSV: let's populate it with seller's belief for now
    new_row['accident_free'] = row.get('accident_free_seller')

    new_row['number_of_keys'] = row.get('number_of_keys')
    
    new_row['auction_start_date'] = row.get('start_time')
    new_row['auction_end_date'] = row.get('end_time')
    new_row['status'] = row.get('status')
    
    # Price
    # Prefer highest_bid_amount, fallback map_bid_offer_amount
    price = row.get('highest_bid_amount')
    if not price:
        price = row.get('max_bid_offer_amount')
    new_row['highest_bid_price'] = price
    
    new_row['number_of_bids'] = row.get('number_of_bids')
    new_row['list_price'] = row.get('list_price')
    new_row['acc'] = row.get('acc')
    
    # Interior / Seats
    new_row['number_of_seats'] = row.get('number_of_seats')
    new_row['electric_seats'] = row.get('electric_seats')
    new_row['leather_seats'] = row.get('leather_seats')
    new_row['head_up_display'] = row.get('head_up_display')
    new_row['seat_heating'] = row.get('seat_heating')
    new_row['sport_seat_type'] = row.get('sport_seat_type')
    new_row['heated_steering_wheel'] = row.get('heated_steering_wheel')
    new_row['sport_steering_wheel'] = row.get('sport_steering_wheel')
    new_row['leather_steering_wheel'] = row.get('leather_steering_wheel')
    new_row['camera_type'] = row.get('camera_type')
    new_row['trailer_hitch_seller'] = row.get('trailer_hitch_seller')
    
    # JSON Parsing: Tires
    tyres = parse_json_safe(row.get('tyres', '[]'))
    new_row['tires_total_sets'] = len(tyres)
    
    has_summer = False
    has_winter = False
    has_all_season = False
    
    for t in tyres:
        ctype = t.get('type', '').lower()
        if 'summer' in ctype: has_summer = True
        if 'winter' in ctype: has_winter = True
        if 'all_season' in ctype or 'allseason' in ctype: has_all_season = True
        
    new_row['tires_summer'] = '1' if has_summer else '0'
    new_row['tires_winter'] = '1' if has_winter else '0'
    new_row['tires_all_season'] = '1' if has_all_season else '0'
    
    # JSON Parsing: Conditions (Damage)
    conditions = parse_json_safe(row.get('conditions', '[]'))
    descriptions = []
    for c in conditions:
        if c.get('title') == 'Damage' or c.get('description'):
             desc = c.get('description', '')
             if desc and desc != "Description not available":
                 descriptions.append(desc)
    
    new_row['damage_description'] = "; ".join(descriptions)
    
    # Other JSONs
    new_row['charging_cables'] = row.get('charging_cables') # It's {type_2} string in CSV, not real JSON often? CHECK
    # In old CSV: "{type_2}"
    # In new CSV head: "{type_2}"
    # So just copy.
    
    new_row['documents'] = row.get('documents')
    new_row['document_type'] = row.get('document_type')
    new_row['form_of_ownership'] = row.get('form_of_ownership')
    new_row['seller_type'] = row.get('seller_type')
    new_row['special_equipment_price'] = row.get('special_equipment_price')
    new_row['service_maintained'] = row.get('service_maintained')
    new_row['smoker_car'] = row.get('smoker_car')
    new_row['pet_car'] = row.get('pet_car')
    
    # IDs
    new_row['auction_id'] = row.get('auction_id')
    new_row['auction_short_id'] = row.get('auction_short_id')
    new_row['auction_sequence'] = row.get('auction_sequence')
    new_row['activated_at'] = row.get('activated_at')
    new_row['auction_created_at'] = row.get('auction_created_at')
    new_row['highest_bider_id'] = row.get('highest_bider_id')
    new_row['highest_bid_at'] = row.get('highest_bid_at')
    new_row['bids_count_calc'] = row.get('bids_count_calc')
    new_row['max_bid_offer_amount'] = row.get('max_bid_offer_amount')
    new_row['min_bid_offer_amount'] = row.get('min_bid_offer_amount')
    new_row['last_bid_at'] = row.get('last_bid_at')
    
    # Highland
    is_highland, reason = get_highland_status(new_row)
    new_row['is_highland'] = is_highland
    new_row['highland_logic_reason'] = reason
    
    return new_row

def main():
    print(f"Reading {INPUT_CSV}...")
    
    processed_rows = []
    
    with open(INPUT_CSV, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            new_row = transform_row(row)
            if new_row:
                processed_rows.append(new_row)
                
    print(f"Processed {len(processed_rows)} Tesla records.")
    
    print(f"Writing to {OUTPUT_CSV}...")
    with open(OUTPUT_CSV, 'w', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=HEADERS)
        writer.writeheader()
        writer.writerows(processed_rows)
        
    print("Done.")

if __name__ == "__main__":
    main()
