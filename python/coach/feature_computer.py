"""
Feature computation module - converts raw data into engineered features
"""
from datetime import datetime, time, date
from typing import Dict, List, Any, Optional
import statistics

class FeatureComputer:
    def __init__(self):
        pass
    
    def compute_all_features(self, raw_data: Dict[str, Any], target_date: date) -> Dict[str, Dict[str, Any]]:
        """Compute all features from raw data snapshot"""
        features = {}
        
        # Sleep features
        features.update(self._compute_sleep_features(raw_data))
        
        # Recovery features
        features.update(self._compute_recovery_features(raw_data))
        
        # Activity/Training features
        features.update(self._compute_activity_features(raw_data))
        
        # Hydration features
        features.update(self._compute_hydration_features(raw_data))
        
        # Nutrition features
        features.update(self._compute_nutrition_features(raw_data))
        
        # Self-report features
        features.update(self._compute_self_report_features(raw_data))
        
        # Productivity features
        features.update(self._compute_productivity_features(raw_data))
        
        # Behavioral/trend features
        features.update(self._compute_behavioral_features(raw_data))
        
        return features
    
    def _compute_sleep_features(self, raw_data: Dict) -> Dict[str, Dict]:
        features = {}
        sleep = raw_data.get('sleep')
        
        if sleep:
            # Basic sleep metrics
            if sleep.get('minutes_asleep'):
                features['sleep_duration_hours'] = {
                    'value_num': sleep['minutes_asleep'] / 60.0,
                    'unit': 'hours',
                    'confidence': 1.0
                }
            
            if sleep.get('time_in_bed') and sleep.get('minutes_asleep'):
                efficiency = (sleep['minutes_asleep'] / sleep['time_in_bed']) * 100
                features['sleep_efficiency'] = {
                    'value_num': round(efficiency, 1),
                    'unit': '%',
                    'confidence': 1.0
                }
            
            # Sleep stage ratios
            total_sleep = sleep.get('minutes_asleep', 0)
            if total_sleep > 0:
                if sleep.get('deep_minutes') is not None:
                    features['deep_ratio'] = {
                        'value_num': round((sleep['deep_minutes'] / total_sleep) * 100, 1),
                        'unit': '%',
                        'confidence': 1.0
                    }
                
                if sleep.get('rem_minutes') is not None:
                    features['rem_ratio'] = {
                        'value_num': round((sleep['rem_minutes'] / total_sleep) * 100, 1),
                        'unit': '%',
                        'confidence': 1.0
                    }
                
                if sleep.get('wake_minutes') is not None:
                    features['wake_ratio'] = {
                        'value_num': round((sleep['wake_minutes'] / total_sleep) * 100, 1),
                        'unit': '%',
                        'confidence': 1.0
                    }
            
            if sleep.get('sleep_score'):
                features['sleep_score'] = {
                    'value_num': sleep['sleep_score'],
                    'unit': 'score',
                    'confidence': 1.0
                }
        
        return features
    
    def _compute_recovery_features(self, raw_data: Dict) -> Dict[str, Dict]:
        features = {}
        hrv = raw_data.get('hrv')
        readiness = raw_data.get('readiness')
        activity = raw_data.get('activity')
        overnight = raw_data.get('overnight')
        
        if hrv:
            if hrv.get('hrv_daily_rmssd'):
                features['hrv_rmssd'] = {
                    'value_num': float(hrv['hrv_daily_rmssd']),
                    'unit': 'ms',
                    'confidence': 1.0
                }
            
            if hrv.get('hrv_deep_rmssd'):
                features['hrv_deep_rmssd'] = {
                    'value_num': float(hrv['hrv_deep_rmssd']),
                    'unit': 'ms',
                    'confidence': 1.0
                }
        
        if readiness and readiness.get('readiness_score'):
            features['readiness_score'] = {
                'value_num': readiness['readiness_score'],
                'unit': 'score',
                'confidence': 1.0
            }
        
        if activity and activity.get('resting_heart_rate'):
            features['resting_heart_rate'] = {
                'value_num': activity['resting_heart_rate'],
                'unit': 'bpm',
                'confidence': 1.0
            }
        
        if overnight:
            if overnight.get('breathing_rate'):
                features['breathing_rate'] = {
                    'value_num': float(overnight['breathing_rate']),
                    'unit': 'breaths/min',
                    'confidence': 1.0
                }
            
            if overnight.get('oxygen_variation'):
                features['oxygen_variation'] = {
                    'value_num': float(overnight['oxygen_variation']),
                    'unit': '%',
                    'confidence': 1.0
                }
            
            if overnight.get('blood_oxygen_avg'):
                features['blood_oxygen_avg'] = {
                    'value_num': float(overnight['blood_oxygen_avg']),
                    'unit': '%',
                    'confidence': 1.0
                }
            
            if overnight.get('skin_temp_relative'):
                features['skin_temp_relative'] = {
                    'value_num': float(overnight['skin_temp_relative']),
                    'unit': '°C',
                    'confidence': 1.0
                }
        
        return features
    
    def _compute_activity_features(self, raw_data: Dict) -> Dict[str, Dict]:
        features = {}
        activity = raw_data.get('activity')
        
        if activity:
            if activity.get('steps'):
                features['steps'] = {
                    'value_num': activity['steps'],
                    'unit': 'steps',
                    'confidence': 1.0
                }
            
            if activity.get('very_active_minutes'):
                features['very_active_minutes'] = {
                    'value_num': activity['very_active_minutes'],
                    'unit': 'minutes',
                    'confidence': 1.0
                }
            
            if activity.get('sedentary_minutes'):
                features['sedentary_minutes'] = {
                    'value_num': activity['sedentary_minutes'],
                    'unit': 'minutes',
                    'confidence': 1.0
                }
            
            if activity.get('distance_total_km'):
                features['distance_total_km'] = {
                    'value_num': float(activity['distance_total_km']),
                    'unit': 'km',
                    'confidence': 1.0
                }
            
            if activity.get('energy_burned_calories_out'):
                features['calories_out'] = {
                    'value_num': float(activity['energy_burned_calories_out']),
                    'unit': 'kcal',
                    'confidence': 1.0
                }
            
            if activity.get('activity_calories'):
                features['activity_calories'] = {
                    'value_num': float(activity['activity_calories']),
                    'unit': 'kcal',
                    'confidence': 1.0
                }
            
            if activity.get('bmr_calories'):
                features['bmr_calories'] = {
                    'value_num': float(activity['bmr_calories']),
                    'unit': 'kcal',
                    'confidence': 1.0
                }
        
        return features
    
    def _compute_hydration_features(self, raw_data: Dict) -> Dict[str, Dict]:
        features = {}
        water_logs = raw_data.get('water', [])
        
        if water_logs:
            total_water = 0
            caffeine_count = 0
            energy_drink_ml = 0
            soda_ml = 0
            
            for log in water_logs:
                amount = log.get('amount_ml', 0)
                source = log.get('source', 'water')
                
                if source == 'water':
                    total_water += amount
                elif source == 'coffee':
                    caffeine_count += 1
                    total_water += amount  # Coffee counts toward hydration
                elif source == 'energy drink':
                    energy_drink_ml += amount
                    total_water += amount
                elif source == 'soda':
                    soda_ml += amount
                    total_water += amount
                elif source == 'tea':
                    total_water += amount
            
            features['total_water_ml'] = {
                'value_num': total_water,
                'unit': 'ml',
                'confidence': 1.0
            }
            
            features['caffeine_cups'] = {
                'value_num': caffeine_count,
                'unit': 'cups',
                'confidence': 1.0
            }
            
            if energy_drink_ml > 0:
                features['energy_drink_ml'] = {
                    'value_num': energy_drink_ml,
                    'unit': 'ml',
                    'confidence': 1.0
                }
            
            if soda_ml > 0:
                features['soda_ml'] = {
                    'value_num': soda_ml,
                    'unit': 'ml',
                    'confidence': 1.0
                }
        
        return features
    
    def _compute_nutrition_features(self, raw_data: Dict) -> Dict[str, Dict]:
        features = {}
        meals = raw_data.get('meals', [])
        
        if meals:
            features['meals_count'] = {
                'value_num': len(meals),
                'unit': 'count',
                'confidence': 1.0
            }
            
            breakfast_logged = any(m.get('meal_type') == 'breakfast' for m in meals)
            dinner_logged = any(m.get('meal_type') == 'dinner' for m in meals)
            
            features['breakfast_logged'] = {
                'value_num': 1 if breakfast_logged else 0,
                'unit': 'boolean',
                'confidence': 1.0
            }
            
            features['dinner_logged'] = {
                'value_num': 1 if dinner_logged else 0,
                'unit': 'boolean',
                'confidence': 1.0
            }
        
        return features
    
    def _compute_self_report_features(self, raw_data: Dict) -> Dict[str, Dict]:
        features = {}
        checkin = raw_data.get('checkin')
        overall = raw_data.get('overall')
        
        if checkin:
            if checkin.get('mood_score') is not None:
                features['mood'] = {
                    'value_num': checkin['mood_score'],
                    'unit': 'score',
                    'confidence': 1.0
                }
            
            if checkin.get('stress_score') is not None:
                features['stress'] = {
                    'value_num': checkin['stress_score'],
                    'unit': 'score',
                    'confidence': 1.0
                }
            
            if checkin.get('energy_score') is not None:
                features['energy'] = {
                    'value_num': checkin['energy_score'],
                    'unit': 'score',
                    'confidence': 1.0
                }
            
            if checkin.get('focus_score') is not None:
                features['focus'] = {
                    'value_num': checkin['focus_score'],
                    'unit': 'score',
                    'confidence': 1.0
                }
            
            if checkin.get('workload_score') is not None:
                features['workload'] = {
                    'value_num': checkin['workload_score'],
                    'unit': 'score',
                    'confidence': 1.0
                }
            
            if checkin.get('social_score') is not None:
                features['social_connectedness'] = {
                    'value_num': checkin['social_score'],
                    'unit': 'score',
                    'confidence': 1.0
                }
            
            if checkin.get('mood_emotions'):
                features['emotions_count'] = {
                    'value_num': len(checkin['mood_emotions']),
                    'unit': 'count',
                    'confidence': 1.0
                }
        
        if overall and overall.get('overall_score') is not None:
            features['overall_score'] = {
                'value_num': overall['overall_score'],
                'unit': 'score',
                'confidence': 1.0
            }
        
        return features
    
    def _compute_productivity_features(self, raw_data: Dict) -> Dict[str, Dict]:
        features = {}
        todos = raw_data.get('todos', [])
        calendar = raw_data.get('calendar', [])
        
        if todos:
            features['todos_count'] = {
                'value_num': len(todos),
                'unit': 'count',
                'confidence': 1.0
            }
            
            completed = sum(1 for t in todos if t.get('is_completed'))
            features['todos_completed_count'] = {
                'value_num': completed,
                'unit': 'count',
                'confidence': 1.0
            }
            
            if len(todos) > 0:
                features['productivity_proxy_todos_completed_ratio'] = {
                    'value_num': round(completed / len(todos), 2),
                    'unit': 'ratio',
                    'confidence': 1.0
                }
        
        if calendar:
            features['calendar_events_count'] = {
                'value_num': len(calendar),
                'unit': 'count',
                'confidence': 1.0
            }
            
            # Calculate total calendar time
            total_minutes = 0
            for event in calendar:
                if event.get('start_time') and event.get('end_time'):
                    start = datetime.fromisoformat(event['start_time'].replace('Z', '+00:00'))
                    end = datetime.fromisoformat(event['end_time'].replace('Z', '+00:00'))
                    total_minutes += (end - start).total_seconds() / 60
            
            features['calendar_total_minutes'] = {
                'value_num': int(total_minutes),
                'unit': 'minutes',
                'confidence': 1.0
            }
        
        return features
    
    def _compute_behavioral_features(self, raw_data: Dict) -> Dict[str, Dict]:
        features = {}
        history = raw_data.get('history_7d', {})
        
        # Compute 7-day baselines and volatility
        checkins = history.get('checkins', [])
        if checkins:
            # Stress metrics
            stress_values = [c['stress_score'] for c in checkins if c.get('stress_score') is not None]
            if len(stress_values) >= 2:
                features['stress_volatility_7d'] = {
                    'value_num': round(statistics.stdev(stress_values), 2),
                    'unit': 'stdev',
                    'confidence': 1.0
                }
                features['stress_vs_7d'] = {
                    'value_num': round(statistics.mean(stress_values), 1),
                    'unit': 'avg',
                    'confidence': 1.0
                }
            
            # Mood metrics
            mood_values = [c['mood_score'] for c in checkins if c.get('mood_score') is not None]
            if len(mood_values) >= 2:
                features['mood_volatility_7d'] = {
                    'value_num': round(statistics.stdev(mood_values), 2),
                    'unit': 'stdev',
                    'confidence': 1.0
                }
            
            # Focus metrics
            focus_values = [c['focus_score'] for c in checkins if c.get('focus_score') is not None]
            if len(focus_values) >= 2:
                features['focus_volatility_7d'] = {
                    'value_num': round(statistics.stdev(focus_values), 2),
                    'unit': 'stdev',
                    'confidence': 1.0
                }
                features['focus_vs_7d'] = {
                    'value_num': round(statistics.mean(focus_values), 1),
                    'unit': 'avg',
                    'confidence': 1.0
                }
            
            # Streaks
            features['daily_checkin_streak'] = {
                'value_num': len(checkins),
                'unit': 'days',
                'confidence': 1.0
            }
        
        # Sleep metrics from history
        sleep_data = history.get('sleep', [])
        if sleep_data:
            durations = [s['minutes_asleep'] / 60.0 for s in sleep_data if s.get('minutes_asleep')]
            if len(durations) >= 2:
                features['sleep_volatility_7d'] = {
                    'value_num': round(statistics.stdev(durations), 2),
                    'unit': 'stdev',
                    'confidence': 1.0
                }
                features['sleep_vs_7d'] = {
                    'value_num': round(statistics.mean(durations), 1),
                    'unit': 'hours',
                    'confidence': 1.0
                }
                features['sleep_duration_streak'] = {
                    'value_num': len(durations),
                    'unit': 'days',
                    'confidence': 1.0
                }
        
        # HRV metrics from history
        hrv_data = history.get('hrv', [])
        if hrv_data:
            hrv_values = [float(h['hrv_daily_rmssd']) for h in hrv_data if h.get('hrv_daily_rmssd')]
            if len(hrv_values) >= 2:
                features['hrv_volatility_7d'] = {
                    'value_num': round(statistics.stdev(hrv_values), 2),
                    'unit': 'stdev',
                    'confidence': 1.0
                }
                features['hrv_vs_7d'] = {
                    'value_num': round(statistics.mean(hrv_values), 1),
                    'unit': 'ms',
                    'confidence': 1.0
                }
        
        # Readiness metrics from history
        readiness_data = history.get('readiness', [])
        if readiness_data:
            readiness_values = [r['readiness_score'] for r in readiness_data if r.get('readiness_score')]
            if len(readiness_values) >= 2:
                features['readiness_vs_7d'] = {
                    'value_num': round(statistics.mean(readiness_values), 1),
                    'unit': 'score',
                    'confidence': 1.0
                }
        
        # Activity metrics from history
        activity_data = history.get('activity', [])
        if activity_data:
            steps_values = [a['steps'] for a in activity_data if a.get('steps')]
            if len(steps_values) >= 2:
                features['steps_vs_7d'] = {
                    'value_num': round(statistics.mean(steps_values), 0),
                    'unit': 'steps',
                    'confidence': 1.0
                }
        
        return features
